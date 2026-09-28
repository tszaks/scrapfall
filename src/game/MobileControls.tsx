import { useEffect, useRef, useState } from "react";
import { touchInput } from "./touch";
import { moveState } from "./input/movement";

const RADIUS = 52;

function Btn({
  label,
  sub,
  onDown,
  onUp,
  onTap,
  dim,
  lit,
  size = 64,
}: {
  label: string;
  sub?: string;
  onDown?: () => void;
  onUp?: () => void;
  onTap?: () => void;
  dim?: boolean;
  /** latched on (the SPRINT toggle) */
  lit?: boolean;
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
        lit
          ? "border-[#e7b25c] bg-[#b4653f]/80 text-[#f7eeda]"
          : dim ? "border-[#f3e6cf]/40 bg-[#2b2118]/35 text-[#f3e6cf]/60" : "border-[#f3e6cf]/90 bg-[#2b2118]/55 text-[#f3e6cf] active:bg-[#b3261e]/70"
      }`}
    >
      <span>{label}</span>
      {sub && <span className="mt-0.5 text-[8px] opacity-70">{sub}</span>}
    </button>
  );
}

/** SPRINT: a toggle (tap to run, tap again to stop); two quick taps = tactical sprint */
function SprintButton() {
  const [st, setSt] = useState<"off" | "on" | "tac">("off");
  useEffect(() => {
    let raf = 0;
    let last = "off";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = moveState.tactical ? "tac" : moveState.sprinting ? "on" : "off";
      if (now !== last) {
        last = now;
        setSt(now);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <Btn
      label={st === "tac" ? "TAC" : "SPRINT"}
      {...(st === "off" ? { sub: "2× TAC" } : {})}
      size={54}
      lit={st !== "off"}
      onTap={() => (touchInput.sprint = true)}
    />
  );
}

export function MobileControls({
  abilityName,
  abilityLeft,
  coop = false,
}: {
  onPause: () => void;
  abilityName: string;
  abilityLeft: number;
  /** in a co-op room: show the hold-to-revive button */
  coop?: boolean;
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

      {/* SPRINT sits on the left edge above where the movement thumb rests */}
      <div className="absolute" style={{ left: "max(1.25rem, env(safe-area-inset-left))", bottom: "calc(max(1.25rem, env(safe-area-inset-bottom)) + 150px)" }}>
        <SprintButton />
      </div>

      {/* squad and building buttons (the big maps): ping, hold to revive, and the elevator
          car's floor button, which only shows while you stand in a car (html.rs-incar) */}
      <div className="absolute flex flex-col items-end gap-2" style={{ right: "max(1.25rem, env(safe-area-inset-right))", bottom: "calc(max(1.25rem, env(safe-area-inset-bottom)) + 96px)" }}>
        <div className="hidden [.rs-incar_&]:block">
          <Btn label="USE" sub="FLOOR" size={56} onTap={() => (touchInput.use = true)} />
        </div>
        <div className="flex items-end gap-2">
          <Btn label="JUMP" size={60} onTap={() => (touchInput.jump = true)} />
          <Btn label="PING" size={48} onTap={() => (touchInput.ping = true)} />
          {coop && (
            <Btn
              label="REVIVE"
              size={48}
              onDown={() => (touchInput.revive = true)}
              onUp={() => (touchInput.revive = false)}
            />
          )}
        </div>
      </div>

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
