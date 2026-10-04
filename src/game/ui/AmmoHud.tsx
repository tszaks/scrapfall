import { useEffect, useRef } from "react";
import { myVehicle } from "../driving";
import { ski } from "../alpine/ski";
import { actionLabel } from "../input/labels";
import { MAGAZINE, reloadDuration, supply } from "../weaponSupply";
import "./ammo-hud.css";

/** Screen-space weapon status; never parent this to the camera or a world Html anchor. */
export function AmmoHud({ weapon, name, total, touch }: {
  weapon: string;
  name: string;
  total: number;
  touch: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      if (!box.current || !count.current || !hint.current || !progress.current) return;
      box.current.hidden = !!myVehicle() || ski.active;
      const loaded = Math.min(total, supply.loaded[weapon] ?? MAGAZINE[weapon] ?? 12);
      const remaining = supply.reloading === weapon ? supply.remaining : 0;
      const counts = `${loaded} / ${Math.max(0, total - loaded)}`;
      const label = remaining > 0
        ? `RELOADING · ${remaining.toFixed(1)}s`
        : total <= 0 ? "OUT OF AMMO" : `${touch ? "TAP" : actionLabel("reload")} · RELOAD`;
      if (count.current.textContent !== counts) count.current.textContent = counts;
      if (hint.current.textContent !== label) hint.current.textContent = label;
      const percent = remaining > 0
        ? Math.round(Math.max(0, Math.min(1, 1 - remaining / reloadDuration(weapon))) * 100)
        : 0;
      progress.current.style.width = `${percent}%`;
      progress.current.parentElement!.setAttribute("aria-valuenow", String(percent));
      progress.current.parentElement!.style.visibility = remaining > 0 ? "visible" : "hidden";
    };
    update();
    // Match the other HUD readouts without rerendering the game on every reload tick.
    const timer = window.setInterval(update, 50);
    return () => window.clearInterval(timer);
  }, [weapon, total, touch]);
  return (
    <div ref={box} data-ammo-hud data-touch={touch} className="ammo-hud" aria-label={`${name} ammunition`}>
      <div className="ammo-hud-name">{name}</div>
      <div ref={count} className="ammo-hud-count" aria-label="Loaded / reserve ammunition" />
      <div ref={hint} className="ammo-hud-hint" />
      <div className="ammo-hud-track" role="progressbar" aria-label="Reload progress" aria-valuemin={0} aria-valuemax={100}>
        <div ref={progress} className="ammo-hud-progress" />
      </div>
    </div>
  );
}
