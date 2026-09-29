// The SCRAPFALL wordmark on the title screen — his menu styling, our arena count.
import { C, Hazard } from "@/bro/game/ui/kit";

export function BrandLogo({ compact }: { compact?: boolean }) {
  return (
    <div className="select-none">
      <div
        className="flex items-center gap-3 text-[11px] font-bold tracking-[0.5em] text-[#e7b25c]"
        style={{ textShadow: "0 1px 0 #2b2118, 0 0 18px rgba(20,14,8,0.9)" }}
      >
        <span className="inline-block h-[7px] w-16" style={{ background: `repeating-linear-gradient(-45deg, ${C.gold} 0 8px, transparent 8px 14px)` }} />
        SZAKACS MEDIA PRESENTS
        <span className="inline-block h-[7px] w-16" style={{ background: `repeating-linear-gradient(-45deg, ${C.gold} 0 8px, transparent 8px 14px)` }} />
      </div>
      <h1
        className={`mt-2 font-black leading-none tracking-[0.04em] text-[#f7eeda] ${
          compact ? "text-[clamp(1.9rem,7.5vh,2.6rem)]" : "text-6xl sm:text-7xl"
        }`}
        style={{ textShadow: "0 3px 0 #2b2118, 0 6px 0 rgba(43,33,24,0.55), 0 0 34px rgba(20,14,8,0.85)" }}
      >
        SCRAP<span className="text-[#e7b25c]">FALL</span>
      </h1>
      <div
        className="mt-3 flex items-center gap-2 text-[11px] font-bold tracking-[0.34em] text-[#f3e6cf]"
        style={{ textShadow: "0 1px 0 #2b2118, 0 0 16px rgba(20,14,8,0.9)" }}
      >
        <Hazard className="w-10 opacity-90" />
        12 WAVES · 15 MAPS · 4-PLAYER CO-OP
      </div>
    </div>
  );
}
