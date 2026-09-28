import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ACTIONS,
  controlState,
  unbindControl,
  bindControl,
  bindingConflicts,
  controlSettings,
  controlSnapshot,
  keyLabel,
  loadControls,
  resetBindings,
  setCapturing,
  setInputMode,
  setSwapSticks,
  subscribeControls,
  tokenLabel,
  supportedToken,
  type ControlAction,
  type ControlDevice,
  type InputMode,
} from "./remap";
import { BTN, glyph, type ButtonName } from "./bindings";
import { consumePress, pollPad } from "./gamepad";
import { useInputDevice } from "./useInputDevice";
const PAD_ACTIONS: ControlAction[] = [
  "fire",
  "jump",
  "sprint",
  "ability",
  "use",
  "prevGun",
  "nextGun",
  "ping",
  "revive",
  "camera",
  "map",
  "time",
  "pause",
  "shop1",
  "shop2",
  "shop3",
  "shopReroll",
  "shopHeal",
  "shopRevive",
];
const names = Object.keys(BTN) as ButtonName[];
export function ControlSettings() {
  loadControls();
  useSyncExternalStore(subscribeControls, controlSnapshot, () => 0);
  const dev = useInputDevice();
  const dialog = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<ControlDevice>("kbm"),
    [capture, setCapture] = useState<ControlAction | null>(null),
    [pending, setPending] = useState<string | number | null>(null),
    [message, setMessage] = useState("");
  const button = (on = false) =>
    `rounded border px-3 py-2 text-[11px] font-bold tracking-wide ${on ? "border-[#b4653f] bg-[#b4653f]/30" : "border-white/20 bg-white/5"}`;
  const label = (token: string | number) =>
    typeof token === "string"
      ? tokenLabel(token)
      : glyph(names.find((n) => BTN[n] === token) || "A", dev.padType);
  const finish = (token: string | number) => {
    if (!capture) return;
    if (
      tab === "kbm"
        ? controlSettings.keys[capture].includes(String(token))
        : controlSettings.pad[capture] === token
    ) {
      setCapture(null);
      return;
    }
    const conflicts = bindingConflicts(tab, capture, token);
    if (conflicts.length || tab === "pad") {
      setPending(token);
      return;
    }
    bindControl(tab, capture, token);
    setMessage(`${ACTIONS[capture][0]}: ${label(token)}`);
    setCapture(null);
  };
  useEffect(() => {
    if (!capture) return;
    setCapturing(true);
    controlState.captureMenu = pending !== null;
    let raf = 0,
      armed = false;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (pending !== null && e.code === "Tab") {
        const choices = [...dialog.current!.querySelectorAll<HTMLButtonElement>("button")];
        const i = choices.indexOf(document.activeElement as HTMLButtonElement);
        choices[(i + (e.shiftKey ? choices.length - 1 : 1)) % choices.length]?.focus();
        stop(e);
        return;
      }
      if (pending !== null && ["Enter", "Space"].includes(e.code)) return;
      stop(e);
      if (e.code === "Escape") {
        setCapture(null);
        setPending(null);
        return;
      }
      if (tab !== "kbm" || pending !== null || e.repeat) return;
      if (
        e.metaKey ||
        ((e.ctrlKey || e.altKey) && !/^(Control|Alt)/.test(e.code)) ||
        !supportedToken(e.code)
      ) {
        setMessage(
          "Choose a keyboard key or mouse button. Escape cancels; system shortcuts stay reserved.",
        );
        return;
      }
      finish(e.code);
    };
    const mouse = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest("[data-capture-choice]")) return;
      stop(e);
      if (tab === "kbm" && pending === null) {
        const event = e.button === 0 ? "click" : "auxclick";
        const swallow = (click: MouseEvent) => {
          if (click.button !== e.button) return;
          click.preventDefault();
          click.stopImmediatePropagation();
          window.removeEventListener(event, swallow, true);
        };
        window.addEventListener(event, swallow, true);
        const menu = (event: MouseEvent) => {
          if (event.button === e.button) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        };
        if (e.button === 2) window.addEventListener("contextmenu", menu, true);
        setTimeout(() => {
          window.removeEventListener(event, swallow, true);
          window.removeEventListener("contextmenu", menu, true);
        }, 600);
        finish(`Mouse${e.button}`);
      }
    };
    const block = (e: Event) => {
      if (!(e.target as HTMLElement)?.closest("[data-capture-choice]")) stop(e);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", mouse, true);
    window.addEventListener("contextmenu", block, true);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (tab !== "pad" || pending !== null) return;
      const p = pollPad();
      if (!p.connected) return;
      if (!armed) {
        armed = !p.down.some(Boolean);
        return;
      }
      const i = p.pressed.findIndex((x, n) => x && n < 16);
      if (i >= 0) {
        consumePress(i);
        finish(i);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mousedown", mouse, true);
      window.removeEventListener("contextmenu", block, true);
      controlState.captureMenu = false;
      setCapturing(false);
    };
  }, [capture, pending, tab]); // capture owns the input until save/cancel
  useEffect(() => {
    if (!capture) return;
    const old = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => old?.focus();
  }, [capture, pending]);
  const rows = tab === "kbm" ? (Object.keys(ACTIONS) as ControlAction[]) : PAD_ACTIONS;
  return (
    <section className="space-y-3 border-t border-white/10 pt-4" aria-label="Custom controls">
      <h3 className="text-[11px] font-bold tracking-[.3em]">CONTROLS</h3>
      <p className="text-[11px] opacity-70">
        Choose an action, then press its new key, mouse button or controller button. Changes save
        automatically.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Input mode">
        {(["auto", "kbm", "pad"] as InputMode[]).map((m) => (
          <button
            key={m}
            className={button(controlSettings.mode === m)}
            aria-pressed={controlSettings.mode === m}
            onClick={() => setInputMode(m)}
          >
            {m === "auto" ? "AUTO DETECT" : m === "kbm" ? "KEYBOARD + MOUSE" : "CONTROLLER ONLY"}
          </button>
        ))}
      </div>
      <p className="text-[10px] opacity-60">
        {dev.padConnected
          ? "Controller connected."
          : "Connect a controller and press a button to detect it."}{" "}
        Escape always pauses. Menu navigation keeps its standard buttons.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["kbm", "pad"] as ControlDevice[]).map((t) => (
          <button
            key={t}
            className={button(tab === t)}
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              setMessage("");
            }}
          >
            {t === "kbm" ? "KEYBOARD / MOUSE BINDINGS" : "CONTROLLER BINDINGS"}
          </button>
        ))}
      </div>
      {tab === "pad" && (
        <button className={button()} onClick={() => setSwapSticks(!controlSettings.swapSticks)}>
          MOVE: {controlSettings.swapSticks ? "RIGHT" : "LEFT"} STICK · LOOK:{" "}
          {controlSettings.swapSticks ? "LEFT" : "RIGHT"} STICK · SWAP
        </button>
      )}
      <div className="max-h-64 overflow-y-auto rounded border border-white/15">
        {rows.map((a) => (
          <div
            key={a}
            className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2 last:border-0"
          >
            <span className="text-[11px]">{ACTIONS[a][0]}</span>
            <button
              aria-label={`Bind ${ACTIONS[a][0]}`}
              className={`${button()} max-w-[55%] break-words`}
              onClick={() => {
                setMessage("");
                setPending(null);
                setCapture(a);
              }}
            >
              {tab === "kbm"
                ? keyLabel(a)
                : controlSettings.pad[a] === undefined
                  ? "UNBOUND"
                  : label(controlSettings.pad[a]!)}
            </button>
          </div>
        ))}
      </div>
      <button
        className={button()}
        onClick={() => {
          resetBindings(tab);
          setMessage("Default bindings restored.");
        }}
      >
        RESTORE {tab === "kbm" ? "KEYBOARD / MOUSE" : "CONTROLLER"} DEFAULTS
      </button>
      <p className="text-[10px] opacity-60">
        Interact takes priority in elevators. Revive takes priority near a downed teammate. The
        default keys share these context actions.
      </p>
      <p role="status" className="text-[11px]">
        {message}
      </p>
      {capture && (
        <div
          ref={dialog}
          data-binding-capture
          role="dialog"
          aria-modal="true"
          aria-label="Assign control"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border border-white/25 bg-[#2b2118] p-5 text-[#f7eeda]">
            <h4 className="text-lg font-bold">{ACTIONS[capture][0]}</h4>
            {pending === null ? (
              <p>
                {tab === "kbm"
                  ? "Press a key or mouse button."
                  : `Release the buttons, then press a controller button. On the next screen, confirm with ${glyph("A", dev.padType)} or cancel with ${glyph("B", dev.padType)}.`}
              </p>
            ) : (
              <p>
                Assign {label(pending)} to {ACTIONS[capture][0]}?{" "}
                {bindingConflicts(tab, capture, pending).length > 0 && (
                  <>
                    This clears that input from{" "}
                    {bindingConflicts(tab, capture, pending)
                      .map((a) => ACTIONS[a][0])
                      .join(", ")}
                    .
                  </>
                )}
              </p>
            )}
            {message && <p>{message}</p>}
            <div data-capture-choice className="flex flex-wrap gap-2">
              {pending === null && (
                <button
                  className={button()}
                  onClick={() => {
                    unbindControl(tab, capture);
                    setMessage(`${ACTIONS[capture][0]} is unbound.`);
                    setCapture(null);
                  }}
                >
                  CLEAR BINDING
                </button>
              )}
              {pending !== null && (
                <>
                  <button
                    className={button()}
                    onClick={() => {
                      bindControl(tab, capture, pending, true);
                      setMessage(`${ACTIONS[capture][0]}: ${label(pending)}`);
                      setCapture(null);
                      setPending(null);
                    }}
                  >
                    USE FOR THIS ACTION
                  </button>
                  <button className={button()} onClick={() => setPending(null)}>
                    TRY ANOTHER
                  </button>
                </>
              )}
              <button
                data-pad-back
                className={button()}
                onClick={() => {
                  setCapture(null);
                  setPending(null);
                }}
              >
                CANCEL
              </button>
            </div>
            <p className="text-xs opacity-70">Escape cancels without changing anything.</p>
          </div>
        </div>
      )}
    </section>
  );
}
