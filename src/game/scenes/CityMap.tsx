// Vice Heights' scene bundle: everything the map mounts, grouped so the whole map's
// code lives behind one lazy import (Game.tsx loads it only when this map shows).
import type { MutableRefObject } from "react";
import type { TimeOfDay } from "../lighting";
import type { TrafficLink } from "../trafficCore";
import type { CityLayout } from "../cityLayout";
import type { Gap } from "../soloBounds";
import { CityScene, CitySun } from "../City";
import { CityTraffic } from "../Traffic";
import { CityBlockades } from "../cityBlockades";

export default function CityMap({
  city,
  trafficCity,
  seed,
  time,
  link,
  isHost,
  gaps,
}: {
  city: CityLayout;
  trafficCity: CityLayout;
  seed: number;
  time: TimeOfDay;
  link: MutableRefObject<TrafficLink>;
  isHost: boolean;
  gaps: Gap[];
}) {
  return (
    <>
      {/* city sun: shadow frustum follows the player, auto-off on slow devices */}
      <CitySun key="sun-city" />
      <CityScene city={city} time={time} isHost={isHost} />
      <CityTraffic city={trafficCity} seed={seed} time={time} link={link} />
      {gaps.length > 0 && <CityBlockades city={city} gaps={gaps} time={time} />}
    </>
  );
}
