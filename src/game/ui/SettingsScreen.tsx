// Tabbed settings in his menu look — Graphics / Controls / Audio — wired to our own options.
import { useEffect, useState } from "react";
import { ACTION_LABEL, binds, keyName, loadBinds, padOpts, resetBinds, saveBinds, type Action } from "../binds";
import { pad } from "../gamepad";
import { QualitySettings } from "@/bro/game/QualitySettings";
import { Hazard, MenuButton, Panel, Scrim, SectionLabel } from "@/bro/game/ui/kit";

export type SettingsTab = "graphics" | "controls" | "controller" | "audio";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "graphics", label: "Graphics" },
  { id: "controls", label: "Controls" },
  { id: "controller", label: "Controller" },
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

function Remap() {
  // his CONTROLS bench: pick an action, press a key or mouse button; clashes are cleared
  const [, bump] = useState(0);
  const [wait, setWait] = useState<Action | null>(null);
  const [msg, setMsg] = useState("");
  const btn = (on = false) =>
    `pointer-events-auto rounded border px-3 py-2 text-[11px] font-bold tracking-wide ${on ? "border-[#b4653f] bg-[#b4653f]/30" : "border-white/20 bg-white/5"}`;
  useEffect(() => {
    loadBinds();
    bump((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!wait) return;
    const assign = (code: string) => {
      const clash = (Object.keys(binds) as Action[]).filter((a) => a !== wait && binds[a] === code);
      for (const a of clash) binds[a] = "";
      binds[wait] = code;
      saveBinds();
      setMsg(`${ACTION_LABEL[wait]}: ${keyName(code)}${clash.length ? ` · CLEARED FROM ${clash.map((a) => ACTION_LABEL[a]).join(", ")}` : ""}`);
      setWait(null);
    };
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") setWait(null);
      else if (e.code === "KeyP") setMsg("P IS RESERVED FOR PAUSE");
      else assign(e.code);
    };
    const mouse = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest("[data-capture-choice]")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      assign(`Mouse${e.button}`);
    };
    const menu = (e: MouseEvent) => e.preventDefault();
    const t = window.setTimeout(() => window.addEventListener("mousedown", mouse, true), 0);
    window.addEventListener("keydown", key, true);
    window.addEventListener("contextmenu", menu, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mousedown", mouse, true);
      window.setTimeout(() => window.removeEventListener("contextmenu", menu, true), 50);
    };
  }, [wait]);
  return (
    <section className="space-y-3 border-t border-white/10 pt-4" aria-label="Custom controls">
      <h3 className="text-[11px] font-bold tracking-[.3em]">CONTROLS</h3>
      <p className="text-[11px] opacity-70">
        Choose an action, then press its new key or mouse button. Changes save automatically.
      </p>
      <div className="max-h-64 overflow-y-auto rounded border border-white/15">
        {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
          <div key={a} className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2 last:border-0">
            <span className="text-[11px]">{ACTION_LABEL[a]}</span>
            <button aria-label={`Bind ${ACTION_LABEL[a]}`} className={`${btn()} max-w-[55%] break-words`} onClick={() => { setMsg(""); setWait(a); }}>
              {keyName(binds[a])}
            </button>
          </div>
        ))}
      </div>
      <button className={btn()} onClick={() => { resetBinds(); setMsg("Default bindings restored."); bump((n) => n + 1); }}>
        RESTORE KEYBOARD / MOUSE DEFAULTS
      </button>
      <p className="text-[11px] opacity-70">
        WASD moves, the mouse looks, P pauses. Left and right click shoot unless you bind them to something else.
      </p>
      <p role="status" className="text-[11px]">{msg}</p>
      {wait && (
        <div data-binding-capture role="dialog" aria-modal="true" aria-label="Assign control" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-white/25 bg-[#2b2118] p-5 text-[#f7eeda]">
            <h4 className="text-lg font-bold">{ACTION_LABEL[wait]}</h4>
            <p>Press a key or mouse button.</p>
            {msg && <p>{msg}</p>}
            <div data-capture-choice className="flex flex-wrap gap-2">
              <button className={btn()} onClick={() => { binds[wait] = ""; saveBinds(); setMsg(`${ACTION_LABEL[wait]} is unbound.`); setWait(null); }}>UNBIND</button>
              <button className={btn()} onClick={() => setWait(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PadTab() {
  const [, bump] = useState(0);
  const [on, setOn] = useState(false);
  useEffect(() => {
    loadBinds();
    const id = window.setInterval(() => setOn(pad.active || [...(navigator.getGamepads?.() ?? [])].some((g) => g?.connected)), 500);
    return () => window.clearInterval(id);
  }, []);
  const set = (f: () => void) => { f(); saveBinds(); bump((n) => n + 1); };
  return (
    <>
      <div className={`rounded border px-3 py-2 text-[11px] font-bold tracking-[0.2em] ${on ? "border-[#7cff4f]/50 text-[#9dff7a]" : "border-[#f3e6cf]/20 opacity-70"}`}>
        {on ? "CONTROLLER CONNECTED" : "NO CONTROLLER · PLUG IN OR PAIR ONE AND PRESS A BUTTON"}
      </div>
      <Slider label="STICK LOOK SPEED" value={padOpts.sens} min={0.3} max={2.5} step={0.1} format={(v) => `${v.toFixed(1)}x`} onChange={(v) => set(() => (padOpts.sens = v))} />
      <button
        onClick={() => set(() => (padOpts.assist = !padOpts.assist))}
        className="pointer-events-auto flex w-full justify-between rounded border border-[#f3e6cf]/20 bg-white/5 px-3 py-2 text-[11px] font-bold tracking-[0.2em]"
      >
        <span>AIM ASSIST</span>
        <span className="text-[#e7b25c]">{padOpts.assist ? "ON" : "OFF"}</span>
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        {["L STICK · MOVE", "R STICK · AIM", "RT · FIRE", "LT · AIM", "A / ✕ · JUMP", "B / ○ · RUN", "Y / △ · ABILITY", "X / □ · USE", "LB / RB · WEAPON", "D-PAD UP · PING", "START · PAUSE"].map((s) => (
          <span key={s} className="rounded border border-[#f3e6cf]/20 bg-white/5 px-2 py-1 text-[11px] font-bold tracking-[0.15em] text-[#f3e6cf]/80">{s}</span>
        ))}
      </div>
    </>
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
  ambVol,
  setAmbVol,
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
  ambVol: number;
  setAmbVol: (v: number) => void;
  touchUi: boolean;
  version: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("graphics");
  const [, setViewTick] = useState(0);
  useEffect(() => loadBinds(), []);
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
              <QualitySettings />
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
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-[11px] font-bold tracking-[0.2em]">CAMERA VIEW</span>
                <div className="flex gap-1.5">
                  {(["FIRST PERSON", "THIRD PERSON"] as const).map((l, i) => (
                    <MenuButton
                      key={l}
                      size="sm"
                      variant={(padOpts.third ? 1 : 0) === i ? "primary" : "line"}
                      onClick={() => {
                        padOpts.third = i === 1;
                        saveBinds();
                        setViewTick((n) => n + 1);
                      }}
                    >
                      {l}
                    </MenuButton>
                  ))}
                </div>
              </div>
              {touchUi ? (
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {["LEFT THUMB · MOVE", "RIGHT THUMB · AIM", "FIRE · SHOOT", "JUMP · RUN · ABILITY"].map((s) => (
                    <span key={s} className="rounded border border-[#f3e6cf]/20 bg-white/5 px-2 py-1 text-[11px] font-bold tracking-[0.15em] text-[#f3e6cf]/80">{s}</span>
                  ))}
                </div>
              ) : (
                <Remap />
              )}
            </>
          )}
          {tab === "controller" && <PadTab />}
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
              <Slider
                label="AMBIENCE VOLUME"
                value={ambVol}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={setAmbVol}
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
            SCRAPFALL · v{version} · TS BUILD
            <div className="mt-0.5 tracking-[0.2em]">
              BASED ON TOBY&apos;S 1.0.6 · BIG MAPS BY TYLER
            </div>
          </div>
        </div>
      </Panel>
    </Scrim>
  );
}
