import { useEffect, useRef } from "react";
import { aimState } from "./input/aim";
import { sightOf } from "./art/sights";
import type { GunId } from "./art/guns";

// The optic overlay for every `scope`-type sight (sights.ts): a vignetted lens with
// crosshair and stadia ticks — the LONGSHOT's magnified glass, the crossbow's
// low-power scope. Magnification itself is the per-gun ADS fov, so a low-power
// scope shows fewer stadia marks.
export function ScopeOverlay({ weapon, active }: { weapon: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const s = sightOf(weapon as GunId);
      const on = active && s.type === "scope" && aimState.blend > 0.9;
      document.documentElement.classList.toggle("rs-scoped", on);
      if (ref.current) {
        ref.current.style.display = on ? "grid" : "none";
        // low-power optics get a shorter, cleaner reticle
        ref.current.classList.toggle("rs-scope-low", (s.fovAbs ?? 75 * s.fovMul) >= 30);
      }
      frame = requestAnimationFrame(step);
    };
    step();
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove("rs-scoped");
    };
  }, [weapon, active]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-10 place-items-center"
      style={{ display: "none" }}
    >
      <div
        style={{
          width: "min(82vh,88vw)",
          height: "min(82vh,88vw)",
          borderRadius: "50%",
          border: "10px solid #111314",
          boxShadow: "0 0 0 100vmax #090b0d",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: 1,
            background: "#131715",
            boxShadow: "0 0 0 1px rgba(235, 240, 230, 0.35)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "#131715",
            boxShadow: "0 0 0 1px rgba(235, 240, 230, 0.35)",
          }}
        />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="[.rs-scope-low_&]:hidden"
            style={{
              position: "absolute",
              left: "50%",
              top: `${50 + i * 5}%`,
              width: 14 + i * 4,
              height: 1,
              background: "#131715",
              boxShadow: "0 0 0 1px rgba(235, 240, 230, 0.35)",
              transform: "translateX(-50%)",
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 3,
            height: 3,
            background: "#ff5a43",
            boxShadow: "0 0 0 1px #1a0905, 0 0 5px #ff5a4380",
            borderRadius: "50%",
            transform: "translate(-50%,-50%)",
          }}
        />
      </div>
    </div>
  );
}
