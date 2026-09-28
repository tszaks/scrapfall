// The CONTROLLER section of the Settings panel: look speed, invert Y, deadzone, response
// curve, aim assist and rumble (saved in localStorage "scrapfall-pad").
import { useSyncExternalStore } from "react";
import { loadPadSettings, padSettings, setPadSettings, subscribePadSettings } from "./bindings";
import { useInputDevice } from "./useInputDevice";

let version = 0;
subscribePadSettings(() => version++);

const CURVES: Record<number, string> = {
  1: "LINEAR",
  1.5: "SOFT",
  2: "CLASSIC",
  2.5: "PRECISE",
  3: "STEEP",
};
const ASSIST = (v: number) =>
  v <= 0 ? "OFF" : v <= 0.25 ? "LOW" : v <= 0.5 ? "STANDARD" : v <= 0.75 ? "HIGH" : "MAX";

export function PadSettingsPanel() {
  loadPadSettings();
  useSyncExternalStore(
    subscribePadSettings,
    () => version,
    () => 0,
  );
  const dev = useInputDevice();
  const s = padSettings;
  const slider = "pointer-events-auto mt-1 w-full accent-[#b4653f]";
  const toggle = (on: boolean) =>
    `pointer-events-auto rounded px-3 py-1 text-[11px] font-bold tracking-widest ${on ? "bg-[#b4653f]" : "bg-white/10"}`;
  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.3em]">CONTROLLER</span>
        <span className="text-[9px] tracking-widest opacity-60">
          {dev.padConnected
            ? `CONNECTED · ${dev.padType === "ps" ? "PLAYSTATION" : dev.padType === "switch" ? "SWITCH PRO" : "XBOX"} LAYOUT`
            : "PLUG IN OR PAIR A PAD, THEN PRESS A BUTTON"}
        </span>
      </div>
      <label className="block">
        LOOK SPEED · {s.sens.toFixed(1)}x
        <input
          type="range"
          min={0.3}
          max={3}
          step={0.1}
          value={s.sens}
          onChange={(e) => setPadSettings({ sens: Number(e.target.value) })}
          className={slider}
        />
      </label>
      <label className="block">
        AIM ASSIST · {ASSIST(s.assist)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.25}
          value={s.assist}
          onChange={(e) => setPadSettings({ assist: Number(e.target.value) })}
          className={slider}
        />
      </label>
      <label className="block">
        RESPONSE CURVE · {CURVES[s.curve] ?? s.curve.toFixed(1)}
        <input
          type="range"
          min={1}
          max={3}
          step={0.5}
          value={s.curve}
          onChange={(e) => setPadSettings({ curve: Number(e.target.value) })}
          className={slider}
        />
      </label>
      <label className="block">
        STICK DEADZONE · {Math.round(s.deadzone * 100)}%
        <input
          type="range"
          min={0}
          max={0.35}
          step={0.01}
          value={s.deadzone}
          onChange={(e) => setPadSettings({ deadzone: Number(e.target.value) })}
          className={slider}
        />
      </label>
      <div className="flex items-center justify-between">
        <span>INVERT LOOK UP/DOWN</span>
        <button
          onClick={() => setPadSettings({ invertY: !s.invertY })}
          className={toggle(s.invertY)}
        >
          {s.invertY ? "ON" : "OFF"}
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span>RUMBLE</span>
        <button onClick={() => setPadSettings({ rumble: !s.rumble })} className={toggle(s.rumble)}>
          {s.rumble ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}
