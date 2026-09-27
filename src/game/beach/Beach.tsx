// Pacific Pier renderer (work in progress).
import type { MutableRefObject } from "react";

import type { Look } from "../lighting";
import type { TrafficLink } from "../trafficCore";
import type { BeachLayout } from "./beachLayout";

export function BeachWorld(props: {
  city: BeachLayout;
  seed: number;
  night: boolean;
  link: MutableRefObject<TrafficLink>;
  look: Look;
}) {
  void props;
  return null;
}
