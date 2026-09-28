import { useEffect, useLayoutEffect, useMemo } from "react";
import { Model, SURF, artMaterial } from "../art/kit";
import { registerStaticGeometry } from "../staticCollision";
import { HOUSE_COLORS, YARD_BOXES } from "./layout";
import { MatchRain } from "../MatchRain";
import * as THREE from "three";

function sceneGeometry() {
  const solid = new Model(),
    detail = new Model();
  const B = (
    m: Model,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    c: string,
  ) => m.box(w, h, d, [x, y + h / 2, z], c, SURF.paint, { bevel: Math.min(0.035, h * 0.12) });
  // A manicured test street is surrounded by a dry Nevada basin, not an empty skybox.
  B(solid, 0, -0.22, 0, 1600, 0.2, 1600, "#bba784");
  B(solid, 0, -0.06, 0, 68, 0.06, 88, "#83935e");
  B(solid, 0, -0.015, 0, 68, 0.018, 17, "#55575a");
  for (const sign of [-1, 1]) {
    B(solid, 0, 0, sign * 9, 68, 0.12, 1, "#c9c6b8");
    B(solid, 0, 0.04, sign * 10.2, 68, 0.07, 1.4, "#ded7c3");
    for (let x = -33; x < 34; x += 2.8)
      B(detail, x, 0.116, sign * 10.2, 0.017, 0.005, 1.4, "#aca99d");
    for (let x = -29; x < 30; x += 5) B(detail, x, 0.012, 0, 2.4, 0.008, 0.11, "#d7cda5");
  }
  for (const b of YARD_BOXES) B(solid, b.x, b.y, b.z, b.w, b.h, b.d, b.c);
  for (const [index, side] of [-1, 1].entries()) {
    const P = (u: number, y: number, v: number): [number, number, number] => [
      u * side,
      y,
      (14 + v) * side,
    ];
    const C = (
      m: Model,
      u: number,
      y: number,
      v: number,
      w: number,
      h: number,
      d: number,
      c: string,
    ) => m.box(w, h, d, P(u, y + h / 2, v), c, SURF.paint, { bevel: 0.015 });
    // Broad gables, contrasting fascia, clapboards and brick chimney define each house.
    const roof = "#635c51",
      trim = "#f0e7d1";
    solid.extrude(
      [
        [-7.45, 6.66],
        [0, 8.55],
        [7.45, 6.66],
      ],
      13.9,
      P(0, 0, 6.5),
      HOUSE_COLORS[index]!,
      SURF.paint,
    );
    const rise = 1.89,
      half = 7.45,
      angle = Math.atan2(rise, half),
      length = Math.hypot(half, rise);
    for (const sign of [-1, 1]) {
      solid.box(length + 0.22, 0.13, 14.2, P((sign * half) / 2, 7.65, 6.5), roof, SURF.rubber, {
        rot: [0, 0, -sign * side * angle],
      });
      for (const v of [-0.58, 13.58])
        detail.box(length + 0.25, 0.2, 0.12, P((sign * half) / 2, 7.58, v), trim, SURF.paint, {
          rot: [0, 0, -sign * side * angle],
        });
    }
    C(solid, 4.8, 6.45, 8.5, 0.85, 2.8, 0.95, "#a36c50");
    C(detail, 4.8, 9.16, 8.5, 1.02, 0.12, 1.12, "#706d63");
    C(solid, 11, 3.25, 5.5, 8.6, 0.22, 12, "#a6a292");
    for (const u of [-7.03, 7.03])
      for (let y = 0.25; y < 6.5; y += 0.19) C(detail, u, y, 6.5, 0.035, 0.036, 12.7, "#a5b39d");
    for (const y of [0, 3.25, 6.55]) C(detail, 0, y, -0.065, 14.3, 0.13, 0.12, trim);
    C(solid, 11, 0.01, -2.4, 8, 0.1, 4.8, "#d0c9b7");
    C(solid, 2.3, 0.01, -2.4, 2.8, 0.1, 4.8, "#d0c9b7");
    // Narrow paving through the lawn makes the two flanking approaches legible.
    C(solid, -10, 0.015, 12, 2.2, 0.04, 32, "#b2ae91");
    C(solid, 18, 0.015, 10, 2.2, 0.04, 30, "#b2ae91");
    for (const u of [-7.04, 7.04]) C(detail, u, 0.02, 6.5, 0.08, 0.45, 13, "#ded5bf");
    // Mailbox, house numbers, patio table, barbecue, clothesline and test mannequins.

    C(detail, -2.8, 1.04, -2.21, 0.23, 0.1, 0.012, "#343d3b");

    C(detail, 12.1, 0.9, 17.5, 0.92, 0.08, 0.77, "#292d2c");
    // Lawn marker targets have supported limbs and round heads, not floating blocks.
    for (const [u, v] of [
      [-2, 20],
      [11, 13.2],
    ] as const) {
      const c = "#d0b596";
      for (const dx of [-0.14, 0.14]) detail.cyl(0.08, 0.74, P(u + dx, 0.49, v), c, SURF.polymer);
      detail.sphere(1, P(u, 1.03, v), c, SURF.polymer, { s: [0.24, 0.33, 0.14] });
      detail.cyl(0.055, 0.1, P(u, 1.39, v), c, SURF.polymer);
      detail.sphere(0.14, P(u, 1.56, v), c, SURF.polymer, { s: [0.87, 1.2, 1] });
      for (const dx of [-0.31, 0.31])
        detail.cyl(0.065, 0.59, P(u + dx, 1.0, v), c, SURF.polymer, { rot: [0, 0, dx * 0.6] });
    }
    // Young trees and clipped hedges frame yards without clogging the combat lanes.
    for (const [u, v] of [
      [-18, 20],
      [26, 19],
    ] as const) {
      solid.cyl(0.22, 3.4, P(u, 1.7, v), "#77624b", SURF.wood, { rb: 0.29 });
      for (const [dx, dy, dz] of [
        [0, 3.8, 0],
        [-1, 4.3, 0.3],
        [0.9, 4.5, -0.4],
      ] as const)
        detail.sphere(1.6, P(u + dx, dy, v + dz), "#65864b", SURF.rubber, { s: [1, 1.25, 1] });
    }
  }
  // School bus: real wheel wells, ribbed yellow panels, double windows and black bumper.
  const bus = new Model();
  B(bus, 0, 1.16, 0, 10.2, 0.79, 2.7, "#dcae3e");
  B(bus, 0.7, 1.95, 0, 8.8, 1.3, 2.7, "#dcae3e");
  B(bus, 0.7, 3.25, 0, 9, 0.2, 2.72, "#e4bb54");
  B(bus, -4.7, 1.26, 0, 1.3, 0.38, 2.54, "#dbb04c");
  for (const z of [-1.365, 1.365]) {
    B(bus, 0.5, 1.26, z, 8.9, 0.045, 0.018, "#363c38");
    B(bus, 0.5, 1.54, z, 8.9, 0.045, 0.018, "#363c38");
    for (let x = -3.1; x < 4.5; x += 0.91) {
      B(bus, x, 2.05, z, 0.77, 0.92, 0.018, "#394f56");
      B(bus, x, 2.45, z, 0.8, 0.04, 0.026, "#9b9e87");
    }
    // Sill segments end before each tyre; no black bar crossing the wheel faces.
    for (const [x, w] of [
      [-4.86, 0.45],
      [-0.15, 5.35],
      [4.82, 0.48],
    ] as const)
      B(bus, x, 0.55, z, w, 0.61, 0.12, "#b48f38");
  }
  for (const x of [-3.75, 3.65])
    for (const z of [-1.32, 1.32]) {
      bus.cyl(0.57, 0.3, [x, 0.57, z], "#20231f", SURF.tyre, { rot: [Math.PI / 2, 0, 0], seg: 24 });
      bus.cyl(0.32, 0.32, [x, 0.57, z], "#93968c", SURF.steel, {
        rot: [Math.PI / 2, 0, 0],
        seg: 16,
      });
    }
  for (const x of [-5.27, 5.27]) B(bus, x, 0.61, 0, 0.17, 0.27, 2.87, "#343a37");
  for (const z of [-0.87, 0.87])
    bus.cyl(0.16, 0.025, [-5.37, 1.12, z], "#e5dcbf", SURF.lens, {
      rot: [0, 0, Math.PI / 2],
      seg: 16,
    });
  B(bus, -3.86, 2.08, 0, 0.03, 1.02, 2.3, "#657c7f");
  // Moving truck: a cabin and a genuinely open, ramp-accessible cargo compartment.
  const truck = new Model();
  B(truck, -4.4, 1.05, 0, 2.2, 0.75, 2.6, "#adc5bc");
  B(truck, -4.18, 1.8, 0, 1.72, 1.1, 2.55, "#adc5bc");
  B(truck, -5.31, 1.89, 0, 0.026, 0.76, 2.18, "#526d71");
  for (const z of [-1.29, 1.29]) {
    B(truck, -4.12, 1.95, z, 1.28, 0.73, 0.018, "#526d71");
    B(truck, -4.5, 1.24, z, 0.16, 0.05, 0.02, "#d4d4c3");
  }
  B(truck, 1, 0.79, 0, 8, 0.2, 2.8, "#a5987b");
  B(truck, 1, 0.99, -1.37, 8, 2.55, 0.13, "#dfd8bb");
  B(truck, 1, 0.99, 1.37, 8, 2.55, 0.13, "#dfd8bb");
  B(truck, -2.94, 0.99, 0, 0.13, 2.55, 2.75, "#dfd8bb");
  B(truck, 1, 3.54, 0, 8, 0.13, 2.8, "#c6c4ad");
  for (const x of [-4.3, 2.8, 4.1])
    for (const z of [-1.32, 1.32]) {
      truck.cyl(0.51, 0.31, [x, 0.51, z], "#242622", SURF.tyre, {
        rot: [Math.PI / 2, 0, 0],
        seg: 24,
      });
      truck.cyl(0.28, 0.33, [x, 0.51, z], "#a9aaa0", SURF.steel, {
        rot: [Math.PI / 2, 0, 0],
        seg: 16,
      });
    }
  // The load is strapped to the front, leaving the back half open as centre cover.
  B(truck, -1.7, 0.99, 0, 1.8, 1.45, 2.1, "#aa9068");
  const bg = bus.build(),
    tg = truck.build();
  const busGeo = bg.clone().translate(-6, 0, -2.8),
    truckGeo = tg.clone().rotateY(Math.PI).translate(8, 0, 3);
  // Ramps rise to the open truck floor, and can be walked from either side of the rear.
  const ramp = new Model();
  ramp.box(2.9, 0.08, 2.5, [1.58, 0.49, 3], "#8d8777", SURF.steel, { rot: [0, 0, 0.315] });
  // Desert silhouettes, power towers and observation buildings outside the play fence.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2,
      r = 140 + (i % 4) * 27;
    detail.sphere(
      1,
      [Math.cos(a) * r, 9 + (i % 5) * 2, Math.sin(a) * r],
      i % 2 ? "#b79b75" : "#c0a884",
      SURF.rubber,
      { s: [35, 18 + (i % 4) * 8, 27], low: true },
    );
  }
  for (const side of [-1, 1]) {
    for (let z = -36; z < 40; z += 18) {
      B(detail, side * 40, 0, z, 0.2, 10, 0.2, "#797163");
      B(detail, side * 40, 9, z, 3, 0.14, 0.18, "#797163");
    }
    B(detail, side * 65, 0, 8, 13, 7, 28, "#9e9580");
    B(detail, side * 65, 7, 8, 14, 0.3, 29, "#686c62");
  }
  const base = solid.build();
  bg.dispose();
  tg.dispose();
  return { base, detail: detail.build(), bus: busGeo, truck: truckGeo, ramp: ramp.build() };
}
export function Nuketown({ seed }: { seed: number }) {
  const built = useMemo(sceneGeometry, []),
    mat = useMemo(() => artMaterial({ wear: 0.13, scale: 2.3 }), []);
  useLayoutEffect(
    () => registerStaticGeometry("map", [built.base, built.bus, built.truck, built.ramp]),
    [built],
  );
  useEffect(
    () => () => {
      Object.values(built).forEach((g) => g.dispose());
      mat.dispose();
    },
    [built, mat],
  );
  return (
    <group name="nuketown">
      <mesh geometry={built.base} material={mat} castShadow receiveShadow />
      <mesh geometry={built.detail} material={mat} castShadow receiveShadow />
      <mesh geometry={built.bus} material={mat} castShadow receiveShadow />
      <mesh geometry={built.truck} material={mat} castShadow receiveShadow />
      <mesh geometry={built.ramp} material={mat} castShadow receiveShadow />
      <MatchRain key={seed} />
    </group>
  );
}
