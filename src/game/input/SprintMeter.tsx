// The tactical-sprint meter on the HUD: drains while a tactical sprint runs (3 s), then
// refills over 6 s. Updated straight from moveState every frame (no React re-renders).
import { useEffect, useRef } from "react";
import { moveState } from "./movement";

export function SprintMeter({ className = "" }: { className?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = moveState;
      const f = s.tactical ? s.tacLeft / 3 : s.tacCharge;
      const state = s.tactical
        ? "TACTICAL"
        : s.sprinting
          ? "SPRINT"
          : s.tacCharge < 1
            ? "RECHARGING"
            : "TAC SPRINT READY";
      if (bar.current) {
        bar.current.style.width = `${Math.round(f * 100)}%`;
        bar.current.style.background = s.tactical
          ? "#e7b25c"
          : s.tacCharge < 1
            ? "#8a7a66"
            : "#1d7a37";
      }
      if (state !== last && tag.current) {
        last = state;
        tag.current.textContent = state;
      }
      if (box.current) box.current.style.opacity = s.sprinting || s.tacCharge < 1 ? "1" : "0.55";
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={box}
      className={`pointer-events-none w-40 rounded-md bg-[#f3e6cf]/80 px-2 py-1 font-mono text-[9px] tracking-widest text-[#2b2118] ${className}`}
    >
      <span ref={tag}>TAC SPRINT READY</span>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-[#2b2118]/25">
        <div ref={bar} className="h-full w-full rounded bg-[#1d7a37]" />
      </div>
    </div>
  );
}
