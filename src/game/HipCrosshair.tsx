// The hipfire crosshair: four ticks whose gap tracks the live spread cone from
// accuracy.ts — it opens when you move or hold the trigger, closes when you settle.
// Once the sights come up the reticle replaces it, so it fades out with the aim blend.
import { useEffect, useRef } from "react";

import { accState } from "./accuracy";
import { aimState } from "./input/aim";

export function HipCrosshair() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      frame = requestAnimationFrame(step);
      const el = ref.current;
      if (!el) return;
      // fade out as the sights rise; gone entirely while scoped
      const hide = Math.min(1, aimState.blend * 2.4);
      el.style.opacity = String(1 - hide);
      el.style.visibility = hide >= 1 ? "hidden" : "visible";
      // the cone's half-angle in px at the current fov — that's the gap radius
      const px = window.innerHeight / (2 * Math.tan(((accState.fov / 2) * Math.PI) / 180));
      const gap = Math.max(6, accState.disp * px);
      el.style.setProperty("--gap", `${gap.toFixed(1)}px`);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, []);
  const tick = { position: "absolute", background: "rgba(43,33,24,0.7)" } as const;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 [.rs-scoped_&]:hidden"
    >
      <div
        style={{
          ...tick,
          top: -1,
          height: 2,
          left: "var(--gap, 10px)",
          width: 11,
        }}
      />
      <div
        style={{
          ...tick,
          top: -1,
          height: 2,
          right: "var(--gap, 10px)",
          width: 11,
        }}
      />
      <div
        style={{
          ...tick,
          left: -1,
          width: 2,
          top: "var(--gap, 10px)",
          height: 11,
        }}
      />
      <div
        style={{
          ...tick,
          left: -1,
          width: 2,
          bottom: "var(--gap, 10px)",
          height: 11,
        }}
      />
      <div
        style={{
          ...tick,
          left: -1,
          top: -1,
          width: 2,
          height: 2,
          borderRadius: "50%",
        }}
      />
    </div>
  );
}
