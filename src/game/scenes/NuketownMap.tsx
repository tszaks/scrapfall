// Nuketown's scene bundle, behind one lazy import (see CityMap.tsx).
import { Nuketown } from "../nuketown/Nuketown";

export default function NuketownMap({ seed }: { seed: number }) {
  return <Nuketown seed={seed} />;
}
