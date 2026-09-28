// Scrapfall menu kit: one type scale, one spacing grid, one button style, shared by every
// screen (title, loadout, pause, recap, settings, shop). Warm paper-and-ink industrial look.
import { useEffect, useState, type ReactNode } from "react";

export const C = {
  ink: "#2b2118",
  inkSoft: "#4a3b2a",
  paper: "#f3e6cf",
  paperDim: "#e6d4b2",
  cream: "#f7eeda",
  rust: "#b4653f",
  rustDark: "#8f4d2e",
  gold: "#e7b25c",
  blood: "#b3261e",
  aqua: "#1aa6b8",
  leaf: "#1d7a37",
} as const;

/** window size flags: `short` is a phone-landscape-height screen, `narrow` a slim width */
export function useViewport() {
  const read = () => ({
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return { ...v, short: v.h < 540, narrow: v.w < 640 };
}

/** shared focus rings: gold ring for pad-nav focus AND keyboard tab focus alike */
export function UiStyles() {
  return (
    <style>{`
      .ui-root :is(button, input, select, [data-pad-focus]):focus-visible {
        outline: 3px solid ${C.gold};
        outline-offset: 2px;
      }
      .ui-root ::selection { background: ${C.rust}; color: ${C.cream}; }
      @keyframes ui-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1 } }
      @keyframes ui-banner {
        0% { opacity: 0; transform: translate(-50%, -14px) scale(0.94) }
        12% { opacity: 1; transform: translate(-50%, 0) scale(1) }
        85% { opacity: 1 }
        100% { opacity: 0; transform: translate(-50%, -8px) }
      }
      @keyframes ui-glow { from { box-shadow: 0 0 0 0 rgba(231,178,92,0.55) } to { box-shadow: 0 0 0 10px rgba(231,178,92,0) } }
      .ui-rise { animation: ui-rise 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) both }
      .ui-rise-1 { animation-delay: 0.05s } .ui-rise-2 { animation-delay: 0.11s }
      .ui-rise-3 { animation-delay: 0.17s } .ui-rise-4 { animation-delay: 0.23s }
      .ui-scroll { scrollbar-width: thin; scrollbar-color: ${C.inkSoft} transparent; }
      .ui-scroll::-webkit-scrollbar { width: 8px; height: 8px }
      .ui-scroll::-webkit-scrollbar-thumb { background: ${C.inkSoft}; border-radius: 4px }
    `}</style>
  );
}

/** diagonal rust/ink hazard stripe — the scrap-yard accent used under headings and on picks */
export function Hazard({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`h-[5px] rounded-sm ${className}`}
      style={{
        background: `repeating-linear-gradient(-45deg, ${C.ink} 0 9px, ${C.rust} 9px 18px)`,
      }}
    />
  );
}

/** small uppercase tracking label above a section */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] font-bold tracking-[0.3em] opacity-55 ${className}`}>
      {children}
    </div>
  );
}

type BtnVariant = "primary" | "ink" | "line" | "ghost" | "paper";
type BtnSize = "sm" | "md" | "lg";

const BTN_BASE =
  "pointer-events-auto select-none rounded-md border-2 font-bold uppercase tracking-[0.18em] transition-[transform,box-shadow,background-color] duration-100 active:translate-y-px disabled:pointer-events-none disabled:opacity-40";

const BTN_VARIANT: Record<BtnVariant, string> = {
  // rust fill, hard ink shadow: the one "go" button on a screen
  primary: `border-[#2b2118] bg-[#b4653f] text-[#f7eeda] shadow-[3px_3px_0_0_#2b2118] [@media(hover:hover)]:hover:bg-[#c4724a]`,
  // dark fill
  ink: `border-[#2b2118] bg-[#2b2118] text-[#f3e6cf] shadow-[3px_3px_0_0_rgba(43,33,24,0.45)] [@media(hover:hover)]:hover:bg-[#3a2d1e]`,
  // outline only — inherits text color from context (paper panels: ink; dark panels: cream)
  line: `border-current bg-transparent`,
  // quiet text link
  ghost: `border-transparent underline decoration-1 underline-offset-4 opacity-70 [@media(hover:hover)]:hover:opacity-100`,
  // cream fill on dark scrims
  paper: `border-[#2b2118] bg-[#f3e6cf] text-[#2b2118] shadow-[3px_3px_0_0_rgba(43,33,24,0.55)] [@media(hover:hover)]:hover:bg-[#fbf2dd]`,
};

const BTN_SIZE: Record<BtnSize, string> = {
  sm: "px-3 py-1.5 text-[10px]",
  md: "px-4 py-2.5 text-xs",
  lg: "px-6 py-3 text-sm",
};

export function MenuButton({
  variant = "ink",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: BtnSize;
}) {
  return (
    <button
      {...rest}
      className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`}
    />
  );
}

/** option chip in a row of picks (maps, difficulty, tabs): bordered, hard-shadowed when on */
export function OptionChip({
  on,
  color,
  disabled,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; color?: string }) {
  return (
    <button
      {...rest}
      disabled={disabled}
      className={`pointer-events-auto select-none rounded-md border-2 px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-[transform,box-shadow] duration-100 disabled:cursor-default ${className}`}
      style={{
        borderColor: C.ink,
        background: on ? (color ?? C.ink) : `${C.ink}14`,
        color: on ? C.cream : C.ink,
        boxShadow: on ? "2px 2px 0 0 rgba(43,33,24,0.85)" : "none",
      }}
    />
  );
}

/** cream paper card on the dimmed world */
export function Panel({
  children,
  className = "",
  dark,
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border-2 font-mono shadow-[0_24px_70px_-18px_rgba(0,0,0,0.75)] ${
        dark
          ? "border-[#b4653f] bg-[#241b12] text-[#f2ead6]"
          : "border-[#2b2118] bg-[#f3e6cf] text-[#2b2118]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** full-screen menu overlay: dims the world toward the edges so the live map shows through */
export function Scrim({
  children,
  className = "",
  strong,
  z = 40,
}: {
  children: ReactNode;
  className?: string;
  /** stronger dim for dense panels (settings, recap) */
  strong?: boolean;
  /** stacking order — PadLayer reads it to find the top-most menu */
  z?: number;
}) {
  return (
    <div
      className={`fixed inset-0 font-mono text-[#f7eeda] ${className}`}
      style={{
        zIndex: z,
        background: strong
          ? "rgba(22,16,9,0.72)"
          : "linear-gradient(180deg, rgba(22,16,9,0.62) 0%, rgba(22,16,9,0.18) 34%, rgba(22,16,9,0.18) 62%, rgba(22,16,9,0.72) 100%)",
      }}
    >
      {children}
    </div>
  );
}

/** HUD chip: translucent paper pill with an ink edge */
export function HudChip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-md border border-[#2b2118]/70 bg-[#f3e6cf]/85 px-3 py-1.5 text-xs tracking-widest text-[#2b2118] shadow-[2px_2px_0_0_rgba(43,33,24,0.3)] ${className}`}
    >
      {children}
    </div>
  );
}

/** the SCRAPFALL wordmark */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="select-none">
      <div
        className="flex items-center gap-3 text-[10px] font-bold tracking-[0.5em] text-[#e7b25c]"
        style={{ textShadow: "0 1px 0 #2b2118, 0 0 18px rgba(20,14,8,0.9)" }}
      >
        <span className="inline-block h-[7px] w-16" style={{ background: `repeating-linear-gradient(-45deg, ${C.gold} 0 8px, transparent 8px 14px)` }} />
        SZAKACS MEDIA PRESENTS
        <span className="inline-block h-[7px] w-16" style={{ background: `repeating-linear-gradient(-45deg, ${C.gold} 0 8px, transparent 8px 14px)` }} />
      </div>
      <h1
        className={`mt-2 font-black leading-none tracking-[0.04em] text-[#f7eeda] ${
          compact ? "text-[2.6rem]" : "text-6xl sm:text-7xl"
        }`}
        style={{
          textShadow:
            "0 3px 0 #2b2118, 0 6px 0 rgba(43,33,24,0.55), 0 0 34px rgba(20,14,8,0.85)",
        }}
      >
        SCRAP<span className="text-[#e7b25c]">FALL</span>
      </h1>
      <div
        className="mt-3 flex items-center gap-2 text-[10px] font-bold tracking-[0.34em] text-[#f3e6cf]"
        style={{ textShadow: "0 1px 0 #2b2118, 0 0 16px rgba(20,14,8,0.9)" }}
      >
        <Hazard className="w-10 opacity-90" />
        12 WAVES · 5 ARENAS · 4-PLAYER CO-OP
      </div>
    </div>
  );
}
