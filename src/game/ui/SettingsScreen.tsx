// Tabbed settings in his menu look — Graphics / Controls / Audio — wired to our own options.
import { useState } from "react";
import { Hazard, MenuButton, Panel, Scrim, SectionLabel } from "@/bro/game/ui/kit";

export type SettingsTab = "graphics" | "controls" | "audio";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "graphics", label: "Graphics" },
  { id: "controls", label: "Controls" },
  { id: "audio", label: "Audio" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold tracking-[0.25em]">{label}</span>
        <span className="text-[11px] font-bold text-[#e7b25c]">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="pointer-events-auto mt-1.5 w-full accent-[#b4653f]"
      />
    </label>
  );
}

export function SettingsScreen({
  fov,
  setFov,
  sensX,
  setSensX,
  sensY,
  setSensY,
  musicVol,
  setMusicVol,
  sfxVol,
  setSfxVol,
  touchUi,
  version,
  onClose,
}: {
  fov: number;
  setFov: (v: number) => void;
  sensX: number;
  setSensX: (v: number) => void;
  sensY: number;
  setSensY: (v: number) => void;
  musicVol: number;
  setMusicVol: (v: number) => void;
  sfxVol: number;
  setSfxVol: (v: number) => void;
  touchUi: boolean;
  version: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("graphics");
  return (
    <Scrim
      strong
      z={50}
      className="ui-root flex touch-auto items-start justify-center overflow-y-auto overscroll-contain p-3 sm:p-6 [@media(max-height:480px)]:p-2"
    >
      <Panel
        dark
        className="ui-rise my-auto flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden p-4 sm:p-5 [@media(max-height:480px)]:max-h-[98dvh] [@media(max-height:480px)]:p-2.5"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <SectionLabel className="text-[#e7b25c] opacity-80 [@media(max-height:480px)]:hidden">
              TUNING BENCH
            </SectionLabel>
            <h2 className="mt-0.5 text-xl font-black tracking-[0.16em] [@media(max-height:480px)]:mt-0 [@media(max-height:480px)]:text-sm">
              SETTINGS
            </h2>
          </div>
          <MenuButton variant="ghost" size="sm" onClick={onClose}>
            ✕ Close
          </MenuButton>
        </div>
        <Hazard className="mt-2.5 [@media(max-height:480px)]:mt-1" />

        <div className="mt-3 flex gap-1.5 [@media(max-height:480px)]:mt-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pointer-events-auto flex-1 rounded-md border-2 px-2 py-2 text-[11px] font-bold tracking-[0.12em] transition-[transform,box-shadow] duration-100 [@media(max-height:480px)]:py-1 ${
                tab === t.id
                  ? "border-[#e7b25c] bg-[#b4653f] text-[#f7eeda] shadow-[2px_2px_0_0_#161009]"
                  : "border-[#f3e6cf]/20 bg-white/5 text-[#f3e6cf]/70 [@media(hover:hover)]:hover:bg-white/10"
              }`}
            >
              {t.label.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="ui-scroll mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-left text-xs tracking-widest [@media(max-height:480px)]:mt-2 [@media(max-height:480px)]:space-y-2">
          {tab === "graphics" && (
            <>
              <Slider
                label="FIELD OF VIEW"
                value={fov}
                min={50}
                max={110}
                step={1}
                format={(v) => `${v}°`}
                onChange={setFov}
              />
              <p className="pt-1 text-xs leading-relaxed opacity-70">
                A WIDER VIEW SHOWS MORE OF THE ARENA; A NARROWER ONE MAKES DISTANT ENEMIES EASIER
                TO HIT.
              </p>
            </>
          )}
          {tab === "controls" && (
            <>
              <Slider
                label="LOOK SPEED · LEFT/RIGHT"
                value={sensX}
                min={0.2}
                max={3}
                step={0.1}
                format={(v) => `${v.toFixed(1)}x`}
                onChange={setSensX}
              />
              <Slider
                label="LOOK SPEED · UP/DOWN"
                value={sensY}
                min={0.2}
                max={3}
                step={0.1}
                format={(v) => `${v.toFixed(1)}x`}
                onChange={setSensY}
              />
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {(touchUi
                  ? ["LEFT THUMB · MOVE", "RIGHT THUMB · AIM", "FIRE · SHOOT", "JUMP · RUN · ABILITY"]
                  : [
                      "WASD · MOVE",
                      "MOUSE · AIM",
                      "CLICK / ENTER · FIRE",
                      "SPACE · JUMP",
                      "SHIFT · RUN",
                      "P · PAUSE",
                    ]
                ).map((s) => (
                  <span
                    key={s}
                    className="rounded border border-[#f3e6cf]/20 bg-white/5 px-2 py-1 text-[11px] font-bold tracking-[0.15em] text-[#f3e6cf]/80"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </>
          )}
          {tab === "audio" && (
            <>
              <Slider
                label="MUSIC VOLUME"
                value={musicVol}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={setMusicVol}
              />
              <Slider
                label="EFFECTS VOLUME"
                value={sfxVol}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={setSfxVol}
              />
              <p className="pt-1 text-xs leading-relaxed opacity-70">
                THE MENU MARCH PLAYS ON THE SCREENS; EACH MAP&apos;S TRACK OPENS UP IN COMBAT.
              </p>
            </>
          )}
        </div>

        <div className="mt-4 border-t border-white/10 pt-3 [@media(max-height:480px)]:mt-2 [@media(max-height:480px)]:pt-2">
          <MenuButton variant="primary" size="md" className="w-full" onClick={onClose}>
            Done
          </MenuButton>
          <div className="mt-3 text-center text-[11px] tracking-[0.3em] opacity-70 [@media(max-height:480px)]:hidden">
            SCRAPFALL · v{version}
          </div>
        </div>
      </Panel>
    </Scrim>
  );
}
