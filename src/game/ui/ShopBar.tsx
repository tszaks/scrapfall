import { perkExplanation } from "../perkLanguage";
// The between-waves shop: a bottom-anchored strip over the live game. pointer-events stay off
// except on the buttons themselves (touch + gamepad buyers; kbm buys with Z X C / R / H).
import { PERK_INFO, PISTOL_MODS, perkCost, type PerkId, type Perks } from "../perks";
import { SELF_REVIVE_COST } from "../soloRevive";
import { KeyHint } from "../input/Glyph";
import type { ControlAction } from "../input/remap";
import { useInputDevice } from "../input/useInputDevice";
import { C } from "./kit";

/** tiny pistol silhouette shown on pistol-mod shop cards */
function PistolBadge() {
  return (
    <svg viewBox="0 0 24 16" className="absolute right-1.5 top-1.5 h-4 w-6 opacity-70" aria-hidden>
      <path d="M2 3h16v4h-4l-1 2H9l-1.5 5H4l1.5-5H2z" fill={C.ink} />
      <rect x="13" y="6.5" width="8" height="1.6" fill={C.ink} />
    </svg>
  );
}

function KeyPip({ action }: { action: ControlAction }) {
  const dev = useInputDevice();
  return (
    <span className="flex min-h-4 min-w-4 items-center justify-center rounded-sm border border-[#f3e6cf]/25 bg-[#2b2118] px-1 text-[11px] font-bold text-[#f7eeda]">
      <KeyHint action={dev.kind === "pad" && (action === "shopHeal" || action === "shopRevive") ? "shopBuy" : action} />
    </span>
  );
}

export function ShopBar({
  offers,
  bought,
  perks,
  shards,
  shopLeft,
  rerollCost,
  freeLeft,
  rerolls,
  health,
  maxHp,
  multiplayer,
  kitReady,
  patchCost,
  touchUi,
  onBuy,
  onReroll,
  onPatch,
  onAmmo,
  ammoCost,
  onKit,
}: {
  offers: PerkId[];
  bought: number[];
  perks: Perks;
  shards: number;
  shopLeft: number;
  rerollCost: number;
  freeLeft: number;
  rerolls: number;
  health: number;
  maxHp: number;
  multiplayer: boolean;
  kitReady: boolean;
  patchCost: number;
  touchUi: boolean;
  onBuy: (i: number) => void;
  onReroll: () => void;
  onPatch: () => void;
  onAmmo: () => void;
  ammoCost: number;
  onKit: () => void;
}) {
  const dev = useInputDevice();
  return (
    <div
      data-pad-shop
      className={`pointer-events-none fixed inset-x-0 z-30 font-mono text-[#2b2118] ${
        // phones: sit in the band between the left thumb zone and the minimap/buttons corner
        touchUi ? "bottom-2 left-[15rem] right-[20.5rem]" : "bottom-6"
      }`}
    >
      <div className="mx-auto w-fit max-w-full rounded-lg border-2 border-[#2b2118] bg-[#f3e6cf]/95 px-3 pt-1.5 pb-2 shadow-[3px_3px_0_0_rgba(43,33,24,0.6)]">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[11px] font-bold tracking-[0.22em]">
          <span style={{ color: C.rust }}>SCRAP SHOP</span>
          <span className="opacity-70">NEXT WAVE IN {shopLeft}s · PISTOL FULL · OTHER AMMO +35%</span>
          <span>
            <span className="text-[#1aa6b8]">◆</span> {shards}
          </span>
          {dev.kind === "pad" && (
            <span className="flex items-center gap-1 opacity-80">
              <KeyHint action="prevGun" />/<KeyHint action="nextGun" /> SELECT ·{" "}
              <KeyHint action="shopBuy" /> BUY
            </span>
          )}
        </div>
        <button onClick={onAmmo} disabled={shards<ammoCost} className="pointer-events-auto mt-2 rounded border border-[#2b2118] px-3 py-1 text-xs disabled:opacity-40">AMMO +50% · ◆ {ammoCost}</button>
        <div
          className={`mt-1.5 flex items-stretch gap-1.5 ${
            touchUi
              ? "ui-scroll pointer-events-auto justify-start overflow-x-auto overscroll-contain"
              : "flex-wrap justify-center"
          }`}
        >
          {!multiplayer && (
            <button
              disabled={kitReady || health <= 0 || shards < SELF_REVIVE_COST}
              onClick={onKit}
              className="pointer-events-auto flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border-2 border-[#2b2118] bg-[#2b2118]/8 px-2.5 py-1.5 text-[11px] disabled:opacity-40"
            >
              <KeyPip action="shopRevive" />
              <b>SELF REVIVE</b>
              <span className="opacity-70">{kitReady ? "KIT READY" : `◆ ${SELF_REVIVE_COST}`}</span>
            </button>
          )}
          <button
            onClick={onPatch}
            disabled={health <= 0 || health >= maxHp || shards < patchCost}
            className="pointer-events-auto flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border-2 border-[#2b2118] bg-[#2b2118]/8 px-2.5 py-1.5 text-[11px] disabled:opacity-40"
          >
            <KeyPip action="shopHeal" />
            <b>FIELD DRESSING</b>
            <span className="opacity-70">
              +5 HP · {health}/{maxHp}
            </span>
            <b>◆ {patchCost}</b>
          </button>
          <button
            onClick={onReroll}
            disabled={shards < rerollCost}
            className="pointer-events-auto flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border-2 border-[#2b2118] bg-[#2b2118]/8 px-2.5 py-1.5 text-[11px] disabled:opacity-40"
          >
            <KeyPip action="shopReroll" />
            <b>REROLL</b>
            <span className="opacity-70">
              {freeLeft > 0
                ? `${freeLeft} FREE LEFT`
                : rerolls > 0
                  ? `USED ${rerolls}x`
                  : "DOUBLES EACH USE"}
            </span>
            <b>{rerollCost === 0 ? "FREE" : `◆ ${rerollCost}`}</b>
          </button>
        </div>
      </div>
      <div
        className={`mt-2 flex gap-2 px-3 sm:gap-3 ${
          touchUi
            ? "ui-scroll pointer-events-auto justify-start overflow-x-auto overscroll-contain pb-1"
            : "flex-wrap justify-center"
        }`}
      >
        {offers.map((id, i) => {
          const info = PERK_INFO[id];
          const cost = perkCost(id, perks[id]);
          if (bought.includes(i)) return null;
          const isMod = PISTOL_MODS.includes(id);
          const afford = shards >= cost;
          return (
            <button
              key={i}
              onClick={() => onBuy(i)}
              className={`pointer-events-auto relative rounded-lg border-2 border-[#2b2118] bg-[#f3e6cf]/95 text-center shadow-[3px_3px_0_0_rgba(43,33,24,0.6)] transition-transform duration-100 [@media(hover:hover)]:hover:-translate-y-0.5 ${touchUi ? "w-32 shrink-0 p-2" : "w-36 p-3 sm:w-44"} ${afford ? "" : "opacity-70"}`}
            >
              <span className="absolute -left-2 -top-2 flex min-h-6 min-w-6 items-center justify-center rounded border border-[#f3e6cf]/30 bg-[#2b2118] px-1 text-xs font-bold text-[#f7eeda]">
                <KeyHint action={`shop${i + 1}` as ControlAction} />
              </span>
              {isMod && <PistolBadge />}
              <div className="mb-1 text-[10px] opacity-65">{isMod ? "PISTOL MOD · USES A SLOT" : "PLAYER UPGRADE"}</div>
              <div className="text-xs font-bold tracking-widest">{info.name}</div>
              {info.pros ? (
                <div className="mt-1 space-y-0.5 text-[11px] leading-snug">
                  {info.pros.map((t) => (
                    <div key={t} className="font-bold text-[#1d7a37]">
                      ▲ {perkExplanation(t)}
                    </div>
                  ))}
                  {info.cons?.map((t) => (
                    <div key={t} className="font-bold text-[#b3261e]">
                      ▼ {perkExplanation(t)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-[11px] leading-snug opacity-80">{perkExplanation(info.desc)}</div>
              )}
              {id !== "heal" && <div className="mt-1 text-[11px] opacity-70">LEVEL {perks[id]}</div>}
              <div className={`mt-2 text-sm font-bold ${afford ? "" : "text-[#b3261e]"}`}>
                ◆ {cost}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
