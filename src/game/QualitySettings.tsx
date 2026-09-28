// The GRAPHICS section of the Settings panel: AUTO / HIGH / MEDIUM / LOW (quality.ts), in the
// same style as the CONTROLLER section next to it. Self-contained: it reads and writes the
// quality store itself.
import { QUALITY_PREFS, antialiasAtLoad, setQualityPref, useQuality } from "./quality";

const HINT = {
  auto: "HOLDS A SMOOTH FRAME RATE: LOWERS THE RESOLUTION, THEN DETAIL, WHEN IT HAS TO",
  high: "FULL RESOLUTION, 2K SHADOWS, STREET REFLECTIONS, LIT ROOMS",
  medium: "LOWER RESOLUTION, SOFTER SHADOWS, CHEAPER REFLECTIONS, LESS RAIN",
  low: "NO SHADOWS OR REFLECTIONS, PLAIN WINDOWS, FEWER EFFECTS",
} as const;

export function QualitySettings() {
  const q = useQuality();
  const pill = (on: boolean) =>
    `pointer-events-auto rounded px-3 py-1 text-[11px] font-bold tracking-widest ${on ? "bg-[#b4653f]" : "bg-white/10 opacity-80 hover:opacity-100"}`;
  return (
    <div className="space-y-2 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.3em]">GRAPHICS</span>
        <span className="text-[9px] tracking-widest opacity-60">
          {q.pref === "auto" ? `AUTO · NOW ${q.tier.toUpperCase()}` : q.pref.toUpperCase()}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {QUALITY_PREFS.map((qp) => (
          <button key={qp} onClick={() => setQualityPref(qp)} className={pill(q.pref === qp)}>
            {qp.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="text-[9px] tracking-widest opacity-60">{HINT[q.pref]}</div>
      {q.spec.antialias !== antialiasAtLoad && (
        <div className="text-[9px] tracking-widest opacity-60">
          ANTIALIASING CHANGES ON THE NEXT LOAD
        </div>
      )}
    </div>
  );
}
