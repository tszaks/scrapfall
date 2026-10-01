// Pacific Pier's scene bundle, behind one lazy import (see CityMap.tsx).
import type { MutableRefObject } from "react";
import type { Look, TimeOfDay } from "../lighting";
import type { TrafficLink } from "../trafficCore";
import type { BeachLayout } from "../beach/beachLayout";
import { BeachWorld } from "../beach/Beach";

export default function BeachMap({
  city,
  seed,
  time,
  link,
  look,
}: {
  city: BeachLayout;
  seed: number;
  time: TimeOfDay;
  link: MutableRefObject<TrafficLink>;
  look: Look;
}) {
  return <BeachWorld key={`beach-${seed}`} city={city} seed={seed} time={time} link={link} look={look} />;
}
