// Title-screen camera: the menu's live backdrop is a hand-framed shot per map — position,
// look target and a slow drift — instead of the spawn's facing, which stared at whatever
// wall happened to be in front. Shots anchor to landmarks in the generated layout (the
// landmark tower on Vice Heights, Dry Gulch's church, the pier's Ferris wheel, Whiteout's
// summit lodge, Nuketown's twin houses), so every seed frames a real view.
import { layoutOf, type Theme } from "./themes";
import { isBeach } from "./beach/beachLayout";
import type { CityLayout } from "./cityLayout";
import type { AlpineLayout } from "./alpine/layout";
import type { WesternLayout } from "./western/layout";
import { groundY } from "./terrain";

export type TitleShot = {
  /** camera position */
  pos: [number, number, number];
  /** the point the shot frames */
  target: [number, number, number];
  /** unit XZ vector pointing screen-right of the aim; the sway slides along it */
  right: [number, number];
  /** sideways drift amplitude, metres */
  sway: number;
  /** drift speed, rad/s */
  rate: number;
  /** extra yaw wander, radians */
  yawAmp: number;
};

function make(
  px: number,
  py: number,
  pz: number,
  tx: number,
  ty: number,
  tz: number,
  sway = 2.4,
  rate = 0.19,
  yawAmp = 0.028,
): TitleShot {
  const dx = tx - px,
    dz = tz - pz;
  const l = Math.hypot(dx, dz) || 1;
  return {
    pos: [px, py, pz],
    target: [tx, ty, tz],
    right: [-dz / l, dx / l],
    sway,
    rate,
    yawAmp,
  };
}

/** The title backdrop shot for the map being shown, or null for the small scatter arenas
 * (reachable only via ?map=), which keep the plain spawn pan. */
export function titleShot(
  theme: Theme,
  city: CityLayout | null,
  western: WesternLayout | null,
): TitleShot | null {
  if (western) {
    // Main Street runs east-west; the spawn faces west down it toward the church. Stand a
    // little east of the spawn, lifted just above the boardwalks, and let the saloon share
    // the frame with the church and the canyon rim behind.
    const s = western.spawn;
    const ch = western.church;
    const saloon = western.buildings.find((b) => b.t === "saloon");
    const sx = saloon ? (saloon.x0 + saloon.x1) / 2 : ch.x;
    const sz = saloon ? (saloon.z0 + saloon.z1) / 2 : ch.z;
    const px = s.x + 14;
    const pz = s.z + 1.5;
    return make(
      px,
      groundY(px, pz) + 4.4,
      pz,
      ch.x * 0.85 + sx * 0.15,
      ch.h * 0.5,
      ch.z * 0.85 + sz * 0.15,
      2.2,
      0.16,
    );
  }
  if (city && "alpine" in city) {
    // Whiteout: from the village street, up the chairlift line to the summit lodge deck
    // against the mountain face.
    const alp = (city as AlpineLayout).alpine;
    const top = alp.terminals.find((t) => t.kind === "top");
    const lodge = alp.lodgeDeck;
    const tx = top ? (top.x0 + top.x1) / 2 + 12 : (lodge.x0 + lodge.x1) / 2;
    const tz = top ? (top.z0 + top.z1) / 2 : (lodge.z0 + lodge.z1) / 2;
    const ty = (top ? top.y : lodge.y) + 14;
    const px = city.spawn.x + 4;
    const pz = city.spawn.z + 16;
    return make(px, groundY(px, pz) + 4.5, pz, tx, ty, tz, 2.6, 0.15);
  }
  if (isBeach(city)) {
    // Pacific Pier: from the dry sand, the Ferris wheel on the pier with the boardwalk
    // in front and the sea behind.
    const w = city.beach.wheel;
    const px = w.x + 130;
    const pz = w.z + 44;
    return make(px, groundY(px, pz) + 4.2, pz, w.x, w.y + w.r * 0.1, w.z, 3, 0.14);
  }
  if (city) {
    // Vice Heights: on the main avenue south of the landmark plaza, a few metres up, looking
    // north down the street canyon at the tower.
    const lm = city.landmark;
    const main = city.roadX.find((r) => r.cls === "main");
    const px = main ? main.c : city.spawn.x;
    const pz = Math.min((lm ? lm.z : city.spawn.z - 80) + 118, city.half - 24);
    return make(
      px,
      9,
      pz,
      lm ? lm.x : px,
      lm ? Math.min(lm.h * 0.4, 95) : 30,
      lm ? lm.z : pz - 120,
      2,
      0.17,
    );
  }
  if (layoutOf(theme) === "nuketown") {
    // The test street runs along x with a house on each side; from its west end both
    // facades frame the bus on the centre line.
    return make(-23, 3.6, 5.5, 16, 2.4, -3, 1.6, 0.16, 0.022);
  }
  return null;
}
