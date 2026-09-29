// Match setup in his look: class cards, ability chips, squad rows, hazard rules and paper panel.
import { ABILITIES, ABILITY_IDS, type AbilityId } from "../abilities";
import { CLASSES, CLASS_IDS, type ClassId } from "../classes";
import { C, Hazard, MenuButton, OptionChip, Panel, Scrim, SectionLabel, useViewport } from "@/bro/game/ui/kit";
import type { LobbyPlayer } from "./TitleScreen";
import type { ReactNode } from "react";

function ClassCard({ id, on, onPick }: { id: ClassId; on: boolean; onPick: () => void }) {
  const k = CLASSES[id];
  return (
    <button
      onClick={onPick}
      className={`pointer-events-auto overflow-hidden rounded-md border-2 text-left transition-[transform,box-shadow] duration-100 ${
        on ? "shadow-[2px_2px_0_0_#2b2118]" : ""
      }`}
      style={{
        borderColor: on ? C.ink : `${C.ink}45`,
        background: on ? k.color : `${C.ink}0c`,
        color: on ? C.cream : C.ink,
      }}
    >
      {!on && <div className="h-1" style={{ background: k.color }} />}
      <div className="px-2 py-1.5">
        <div className="text-[11px] font-bold tracking-[0.1em]">{k.name}</div>
        <div className="text-[11px] font-bold uppercase leading-tight tracking-[0.06em] opacity-70">
          {k.role}
        </div>
      </div>
    </button>
  );
}

export function LoadoutScreen({
  cls,
  setCls,
  ability,
  setAbility,
  mapName,
  weather,
  multiplayer,
  isHost,
  players,
  mapPicker,
  onEnter,
  onBack,
  touchUi,
}: {
  cls: ClassId;
  setCls: (c: ClassId) => void;
  ability: AbilityId;
  setAbility: (a: AbilityId) => void;
  mapName: string;
  weather: string;
  multiplayer: boolean;
  isHost: boolean;
  players: LobbyPlayer[];
  mapPicker?: ReactNode | undefined;
  onEnter: () => void;
  onBack: () => void;
  touchUi: boolean;
}) {
  const { short } = useViewport();
  const compact = short || touchUi;
  const guest = multiplayer && !isHost;
  const pad = compact ? "p-3" : "p-4 sm:p-5";

  return (
    <Scrim
      strong
      className="ui-root flex touch-auto items-start justify-center overflow-y-auto overscroll-contain p-3 sm:p-6"
    >
      <Panel
        className={`ui-rise ui-scroll my-auto max-h-[96dvh] w-full max-w-3xl overflow-y-auto ${pad} [@media(max-height:760px)]:p-3`}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel>MATCH SETUP</SectionLabel>
            <div className="mt-0.5 flex items-center gap-3">
              <h2 className="text-xl font-black tracking-[0.14em] sm:text-2xl">LOADOUT</h2>
              <span className="rounded bg-[#2b2118] px-2 py-0.5 text-[11px] font-bold tracking-[0.18em] text-[#f3e6cf]">
                {weather.toUpperCase()}
              </span>
            </div>
          </div>
          <MenuButton variant="ghost" size="sm" onClick={onBack}>
            ✕ Back
          </MenuButton>
        </div>
        <Hazard className="mt-2.5 [@media(max-height:760px)]:mt-1.5" />

        {/* class row */}
        <div className="mt-3.5 [@media(max-height:760px)]:mt-2.5">
          <SectionLabel>CLASS</SectionLabel>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            {CLASS_IDS.map((c) => (
              <ClassCard key={c} id={c} on={cls === c} onPick={() => setCls(c)} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] font-bold tracking-[0.08em]">
            {CLASSES[cls].pros.map((t) => (
              <span key={t} style={{ color: C.leaf }}>
                ▲ {t}
              </span>
            ))}
            {CLASSES[cls].cons.map((t) => (
              <span key={t} style={{ color: C.blood }}>
                ▼ {t}
              </span>
            ))}
          </div>
        </div>

        {/* ability */}
        <div className="mt-3.5 [@media(max-height:760px)]:mt-2.5">
          <SectionLabel>ABILITY · {ABILITIES[ability].desc.toUpperCase()}</SectionLabel>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {ABILITY_IDS.map((a) => (
              <OptionChip key={a} on={ability === a} onClick={() => setAbility(a)}>
                {ABILITIES[a].name}
                <span className="ml-1 font-normal opacity-70">{ABILITIES[a].cd}s</span>
              </OptionChip>
            ))}
          </div>
        </div>

        {/* arena */}
        <div className="mt-3.5 [@media(max-height:760px)]:mt-2.5">
          <div className="flex items-baseline justify-between">
            <SectionLabel>{guest ? "ARENA · THE HOST PICKS" : "ARENA"}</SectionLabel>
            <span className="text-[11px] tracking-[0.15em] opacity-70">
              THE LIVE MAP BEHIND THIS MENU IS YOUR ARENA
            </span>
          </div>
          <div className="mt-1.5 rounded-md border-2 border-[#2b2118]/25 bg-[#2b2118]/6 px-2.5 py-2">
            <div className="text-[11px] font-bold tracking-[0.14em]">{mapName.toUpperCase()}</div>
            {mapPicker ? <div className="mt-2">{mapPicker}</div> : null}
          </div>
        </div>

        {/* squad (co-op only) */}
        {multiplayer && (
          <div className="mt-3.5 [@media(max-height:760px)]:mt-2.5">
            <SectionLabel>SQUAD</SectionLabel>
            <div className="mt-1.5 space-y-1">
              {players.map((p) => (
                <div
                  key={p.num}
                  className="flex items-center gap-2 rounded-md border border-[#2b2118]/25 bg-[#2b2118]/6 px-2.5 py-1.5"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px] border border-[#2b2118]"
                    style={{ background: p.color }}
                  />
                  <span className="text-[11px] font-bold tracking-[0.15em]">
                    {p.num === 1 ? "HOST" : `P${p.num}`}
                    {p.me && <span className="opacity-70"> · YOU</span>}
                  </span>
                  <span className="ml-auto text-[11px] tracking-[0.12em] opacity-70">
                    <span style={{ color: p.clsColor }}>{p.cls ?? "—"}</span> · {p.ability ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* footer */}
        <div className="mt-4 flex items-center gap-2 border-t-2 border-[#2b2118]/20 pt-3.5 [@media(max-height:760px)]:mt-2.5 [@media(max-height:760px)]:pt-2.5">
          {guest ? (
            <>
              <div className="flex-1 rounded-md bg-[#2b2118]/10 px-4 py-3 text-center text-[11px] font-bold tracking-[0.18em] opacity-70">
                WAITING FOR THE HOST TO START
              </div>
              <MenuButton variant="line" size={compact ? "md" : "lg"} onClick={onBack}>
                Back to lobby
              </MenuButton>
            </>
          ) : (
            <>
              <MenuButton
                variant="primary"
                size={compact ? "md" : "lg"}
                className="flex-1"
                onClick={onEnter}
              >
                Enter arena
              </MenuButton>
              {multiplayer && (
                <span className="whitespace-nowrap text-[11px] tracking-[0.15em] opacity-70">
                  {players.length} IN SQUAD
                </span>
              )}
            </>
          )}
        </div>
      </Panel>
    </Scrim>
  );
}
