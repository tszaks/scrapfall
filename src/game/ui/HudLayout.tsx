import { Children, useEffect, useRef, type ReactNode } from "react";
import { KeyHint } from "../input/Glyph";
import { useInputDevice } from "../input/useInputDevice";
import "./hud-layout.css";

export function HudTop({
  match,
  inventory,
  vitals,
  activeWeapon,
}: {
  match: ReactNode;
  inventory: ReactNode;
  vitals: ReactNode;
  activeWeapon: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const device = useInputDevice();
  const slots = Children.count(inventory);
  useEffect(() => {
    const container = strip.current;
    if (!container) return;
    const reveal = () => {
      const active = container.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) return;
      const box = container.getBoundingClientRect();
      const card = active.getBoundingClientRect();
      if (card.left < box.left) container.scrollLeft += card.left - box.left;
      else if (card.right > box.right) container.scrollLeft += card.right - box.right;
    };
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(container);
    for (const card of container.children) resize.observe(card);
    return () => resize.disconnect();
  }, [activeWeapon, device.kind, slots]);
  return (
    <div className="hud-top" data-hud-top>
      <div className="hud-match" data-hud-match>
        {match}
      </div>
      <div className="hud-loadout" data-hud-loadout>
        <div ref={strip} className="hud-inventory" data-hud-inventory aria-label="Weapons">
          {inventory}
        </div>
        {device.kind !== "touch" && (
          <div className="hud-swap-hint">
            <KeyHint action="prevGun" /> / <KeyHint action="nextGun" /> · SWITCH WEAPON
          </div>
        )}
      </div>
      <div className="hud-vitals" data-hud-vitals>
        {vitals}
      </div>
    </div>
  );
}
