import { useRef, useState } from "react";
import { touchInput } from "./touch";

const RADIUS = 52;

function Btn({
  label,
  sub,
  onDown,
  onUp,
  onTap,
  dim,
  size = 64,
}: {
  label: string;
  sub?: string;
  onDown?: () => void;
  onUp?: () => void;
  onTap?: () => void;
  dim?: boolean;
  size?: number;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown?.();
        onTap?.();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ width: size, height: size }}
      className={`pointer-events-auto flex touch-none flex-col items-center justify-center rounded-full border-2 font-mono text-[11px] font-bold tracking-widest shadow-lg backdrop-blur-sm transition-transform active:scale-95 ${
        dim ? "border-[#f3e6cf]/40 bg-[#2b2118]/35 text-[#f3e6cf]/60" : "border-[#f3e6cf]/90 bg-[#2b2118]/55 text-[#f3e6cf] active:bg-[#b3261e]/70"
      }`}
    >
      <span>{label}</span>
      {sub && <span className="mt-0.5 text-[8px] opacity-70">{sub}</span>}
    </button>
  );
}

export function MobileControls({
  onPause,
  abilityName,
  abilityLeft,
}: {
  onPause: () => void;
  abilityName: string;
  abilityLeft: number;
}) {
  const [stick, setStick] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const moveId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  const endMove = () => {
    moveId.current = null;
    touchInput.moveX = 0;
    touchInput.moveZ = 0;
    setStick(null);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 touch-none select-none">
      {/* left half — floating movement stick */}
      <div
        className="pointer-events-auto absolute bottom-0 left-0 top-0 w-1/2 touch-none"
        onPointerDown={(e) => {
          if (moveId.current !== null) return;
          moveId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          setStick({ ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 });
        }}
        onPointerMove={(e) => {
          if (moveId.current !== e.pointerId || !stick) return;
          let dx = e.clientX - stick.ox;
          let dy = e.clientY - stick.oy;
          const len = Math.hypot(dx, dy);
          if (len > RADIUS) {
            dx = (dx / len) * RADIUS;
            dy = (dy / len) * RADIUS;
          }
          touchInput.moveX = dx / RADIUS;
          touchInput.moveZ = -dy / RADIUS;
          setStick((s) => (s ? { ...s, dx, dy } : s));
        }}
        onPointerUp={endMove}
        onPointerCancel={endMove}
      />

      {/* right half — look/aim drag */}
      <div
        className="pointer-events-auto absolute bottom-0 right-0 top-0 w-1/2 touch-none"
        onPointerDown={(e) => {
          if (lookId.current !== null) return;
          lookId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (lookId.current !== e.pointerId) return;
          touchInput.lookX += e.clientX - last.current.x;
          touchInput.lookY += e.clientY - last.current.y;
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (lookId.current = null)}
        onPointerCancel={() => (lookId.current = null)}
      />

      {stick && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-[#f3e6cf]/60 bg-[#2b2118]/25"
          style={{ left: stick.ox - RADIUS, top: stick.oy - RADIUS, width: RADIUS * 2, height: RADIUS * 2 }}
        >
          <div
            className="absolute rounded-full bg-[#f3e6cf]/80"
            style={{ left: RADIUS - 22 + stick.dx, top: RADIUS - 22 + stick.dy, width: 44, height: 44 }}
          />
        </div>
      )}

      {/* action buttons */}
      <div className="absolute flex items-end gap-4" style={{ right: "max(1.25rem, env(safe-area-inset-right))", bottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <Btn
          label={abilityLeft > 0 ? `${Math.ceil(abilityLeft)}s` : abilityName.slice(0, 5).toUpperCase()}
          sub="ABILITY"
          size={66}
          dim={abilityLeft > 0}
          onTap={() => (touchInput.ability = true)}
        />
        <Btn
          label="FIRE"
          size={86}
          onDown={() => (touchInput.fire = true)}
          onUp={() => (touchInput.fire = false)}
        />
      </div>

    </div>
  );
}
