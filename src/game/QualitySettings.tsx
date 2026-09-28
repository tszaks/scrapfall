// The GRAPHICS row of the settings panel: AUTO / HIGH / MEDIUM / LOW (quality.ts).
// Self-contained (reads and writes the quality store itself), so any settings screen can
// drop it in.
import { QUALITY_PREFS, antialiasAtLoad, setQualityPref, useQuality } from "./quality";

export function QualitySettings() {
  const q = useQuality();
  return (
    <div className="block">
      GRAPHICS · {q.pref === "auto" ? `AUTO (${q.tier.toUpperCase()})` : q.pref.toUpperCase()}
      <div className="mt-1 grid grid-cols-4 gap-1">
        {QUALITY_PREFS.map((qp) => (
          <button
            key={qp}
            onClick={() => setQualityPref(qp)}
            className={`pointer-events-auto rounded px-1 py-2 text-[10px] tracking-widest ${q.pref === qp ? "bg-[#b4653f] text-[#f3e6cf]" : "bg-white/10 opacity-70 hover:opacity-100"}`}
          >
            {qp.toUpperCase()}
          </button>
        ))}
      </div>
      {q.spec.antialias !== antialiasAtLoad && (
        <div className="mt-1 text-[10px] opacity-60">ANTIALIASING CHANGES ON THE NEXT LOAD</div>
      )}
    </div>
  );
}
