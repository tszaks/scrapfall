import { useEffect, useRef } from "react";
import { aimState } from "./input/aim";
export function ScopeOverlay({ weapon, active }: { weapon: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const on = active && weapon === "sniper" && aimState.blend > 0.9;
      document.documentElement.classList.toggle("rs-scoped", on);
      if (ref.current) ref.current.style.display = on ? "grid" : "none";
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
          }}
        />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: `${50 + i * 5}%`,
              width: 14 + i * 4,
              height: 1,
              background: "#131715",
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
            background: "#ab3426",
            borderRadius: "50%",
            transform: "translate(-50%,-50%)",
          }}
        />
      </div>
    </div>
  );
}
