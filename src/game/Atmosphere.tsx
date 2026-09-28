// Per-map sky and haze for the current time of day: points the directional haze at the
// sun, and gives the small arena maps their background (a flat night colour, or a sunset
// sky painted from the map's own palette). The city paints its own sky in City.tsx.
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

import { ARENA_SUN, type Look, type TimeOfDay } from "./lighting";
import { SUN_DIR, arenaSunsetSky } from "./sky";
import { skyFog } from "./skyFog";
import type { Theme } from "./themes";

export function Atmosphere({
  theme,
  time,
  look,
  city,
}: {
  theme: Theme;
  time: TimeOfDay;
  look: Look;
  city: boolean;
}) {
  const scene = useThree((s) => s.scene);
  const { color: sunHaze, k } = look.fogSun;
  useEffect(() => {
    const d = city ? SUN_DIR[time] : ARENA_SUN[time];
    skyFog.fogSunDir.value.set(d[0], d[1], d[2]).normalize();
    skyFog.fogSunColor.value.set(sunHaze);
    skyFog.fogSunK.value = k;
  }, [city, time, sunHaze, k]);
  useEffect(() => {
    if (city) return;
    const prev = scene.background;
    scene.background =
      time === "sunset"
        ? arenaSunsetSky(theme.name, theme.sky, ARENA_SUN.sunset)
        : new THREE.Color(look.sky);
    return () => {
      scene.background = prev;
    };
  }, [city, time, theme, look.sky, scene]);
  return null;
}
