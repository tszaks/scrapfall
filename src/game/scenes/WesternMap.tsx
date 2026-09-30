// Dry Gulch's scene bundle, behind one lazy import (see CityMap.tsx).
import type { MutableRefObject } from "react";
import type { TimeOfDay } from "../lighting";
import type { TrafficLink } from "../trafficCore";
import type { WesternLayout } from "../western/layout";
import type { Block } from "../level";
import type { Gap } from "../soloBounds";
import { WesternScene, WesternSun } from "../western/Western";
import { WesternTrain } from "../western/Train";
import { WesternRiders } from "../western/Riders";
import { Tumbleweeds } from "../western/Tumbleweeds";
import { WesternWeather } from "../western/Weather";
import { WesternBlockades } from "../western/Blockades";

export default function WesternMap({
  layout,
  seed,
  time,
  link,
  blocks,
  gaps,
}: {
  layout: WesternLayout;
  seed: number;
  time: TimeOfDay;
  link: MutableRefObject<TrafficLink>;
  blocks: Block[];
  gaps: Gap[];
}) {
  return (
    <>
      <WesternSun key="sun-western" />
      <WesternScene layout={layout} time={time} />
      <WesternTrain layout={layout} seed={seed} time={time} link={link} />
      <WesternRiders layout={layout} seed={seed} link={link} />
      <Tumbleweeds />
      <WesternWeather layout={layout} time={time} blocks={blocks} link={link} />
      {gaps.length > 0 && <WesternBlockades layout={layout} gaps={gaps} time={time} />}
    </>
  );
}
