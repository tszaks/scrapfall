// Whiteout's scene bundle, behind one lazy import (see CityMap.tsx).
import type { MutableRefObject } from "react";
import type { TimeOfDay } from "../lighting";
import type { TrafficLink } from "../trafficCore";
import type { AlpineLayout } from "../alpine/layout";
import { AlpineScene, AlpineSun } from "../alpine/Alpine";
import { AlpineLife } from "../life/AlpineLife";

export default function AlpineMap({
  layout,
  seed,
  time,
  isHost,
  playing,
  link,
}: {
  layout: AlpineLayout;
  seed: number;
  time: TimeOfDay;
  isHost: boolean;
  playing: boolean;
  link: MutableRefObject<TrafficLink>;
}) {
  return (
    <>
      <AlpineSun key="sun-alpine" />
      <AlpineScene
        key={seed}
        layout={layout}
        time={time}
        isHost={isHost}
        playing={playing}
      />
      <AlpineLife layout={layout} link={link} />
    </>
  );
}
