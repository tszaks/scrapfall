// The loadout screen: class cards, ability grid, difficulty cards, and painted map preview
// cards. Guests see the host's map/difficulty choices read-only and toggle READY instead.
import { ABILITIES, ABILITY_IDS, type AbilityId } from "../abilities";
import { CLASSES, CLASS_IDS, type ClassId } from "../classes";
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from "../difficulty";
import { offered, THEMES } from "../themes";
import { colorFor } from "../net";
import { C, Hazard, MenuButton, OptionChip, Panel, Scrim, SectionLabel, useViewport } from "./kit";
import { MAP_BLURB, MapThumb } from "./mapArt";
import type { LobbyPlayer } from "./TitleScreen";

function ClassCard({
  id,
  on,
  onPick,
}: {
  id: ClassId;
  on: boolean;
  onPick: () => void;
}) {
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

function DifficultyCard({
  id,
  on,
  disabled,
  onPick,
}: {
  id: DifficultyId;
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  const d = DIFFICULTIES[id];
  return (
    <button
      onClick={onPick}
      disabled={disabled}
      className={`pointer-events-auto rounded-md border-2 px-2.5 py-2 text-left transition-[transform,box-shadow] duration-100 disabled:cursor-default ${
        on ? "shadow-[2px_2px_0_0_#2b2118]" : "opacity-80"
      }`}
      style={{
        borderColor: on ? C.ink : `${C.ink}45`,
        background: on ? d.color : `${C.ink}0c`,
        color: on ? C.cream : C.ink,
      }}
    >
      <div className="text-[11px] font-bold tracking-[0.1em]">{d.name}</div>
      <div
        className={`mt-0.5 text-[11px] font-bold tracking-[0.08em] ${on ? "opacity-85" : "opacity-70"}`}
      >
        CROWD ×{d.countMul.toFixed(2)}
      </div>
    </button>
  );
}

export function LoadoutScreen({
  cls,
  setCls,
  ability,
  setAbility,
  mapChoice,
  pickMap,
  seed,
  difficulty,
  pickDifficulty,
  isHost,
  multiplayer,
  players,
  ready,
  onReady,
  weather,
  onEnter,
  onBack,
  touchUi,
}: {
  cls: ClassId;
  setCls: (c: ClassId) => void;
  ability: AbilityId;
  setAbility: (a: AbilityId) => void;
  mapChoice: number | null;
  pickMap: (i: number | null) => void;
  seed: number;
  difficulty: DifficultyId;
  pickDifficulty: (d: DifficultyId) => void;
  isHost: boolean;
  multiplayer: boolean;
  players: LobbyPlayer[];
  ready: boolean;
  onReady: (v: boolean) => void;
  weather: string;
  onEnter: () => void;
  onBack: () => void;
  touchUi: boolean;
}) {
  const { short, narrow } = useViewport();
  const compact = short || touchUi;
  const maps = THEMES.flatMap((t, i) => (offered(t) || mapChoice === i ? [i] : []));
  const guest = multiplayer && !isHost;
  const pad = compact ? "p-3" : "p-4 sm:p-5";

  return (
    <Scrim
      strong
      className="ui-root flex touch-auto items-start justify-center overflow-y-auto overscroll-contain p-3 sm:p-6"
    >
      <Panel
        className={`ui-rise my-auto max-h-[96dvh] w-full max-w-3xl overflow-y-auto ui-scroll ${pad} [@media(max-height:760px)]:p-3`}
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
          <MenuButton variant="ghost" size="sm" data-pad-back onClick={onBack}>
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

        {/* map picker: painted postcards, host chooses */}
        <div className="mt-3.5 [@media(max-height:760px)]:mt-2.5">
          <div className="flex items-baseline justify-between">
            <SectionLabel>{guest ? "ARENA · THE HOST PICKS" : "ARENA"}</SectionLabel>
            {!guest && (
              <span className="text-[11px] tracking-[0.15em] opacity-70">
                THE LIVE MAP BEHIND THIS MENU IS YOUR PICK
              </span>
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <button
              onClick={() => !guest && pickMap(null)}
              disabled={guest}
              className={`pointer-events-auto overflow-hidden rounded-md border-2 text-left transition-[transform,box-shadow] duration-100 disabled:cursor-default ${
                isHost && mapChoice === null ? "shadow-[3px_3px_0_0_#2b2118]" : ""
              }`}
              style={{
                borderColor: isHost && mapChoice === null ? C.ink : `${C.ink}45`,
                background: `${C.ink}0c`,
              }}
            >
              <div
                className="flex aspect-[264/132] items-center justify-center text-2xl font-black [@media(max-height:760px)]:aspect-[264/104]"
                style={{
                  background: `repeating-linear-gradient(-45deg, ${C.ink} 0 12px, #4a3b2a 12px 24px)`,
                  color: C.gold,
                }}
              >
                ?
              </div>
              <div className="border-t border-[#2b2118]/25 px-1.5 py-1">
                <div className="text-[11px] font-bold tracking-[0.12em]">RANDOM</div>
                <div className="text-[11px] leading-tight opacity-70">Shuffle all arenas.</div>
              </div>
            </button>
            {maps.map((i) => {
              const th = THEMES[i]!;
              const on = isHost ? mapChoice === i : i === seed % THEMES.length;
              const info = MAP_BLURB[th.name];
              return (
                <button
                  key={th.name}
                  onClick={() => !guest && pickMap(i)}
                  disabled={guest}
                  className={`pointer-events-auto overflow-hidden rounded-md border-2 text-left transition-[transform,box-shadow] duration-100 disabled:cursor-default ${
                    on ? "shadow-[3px_3px_0_0_#2b2118]" : ""
                  }`}
                  style={{
                    borderColor: on ? C.ink : `${C.ink}45`,
                    background: on ? `${C.gold}30` : `${C.ink}0c`,
                  }}
                >
                  <div className="relative">
                    <MapThumb theme={th} />
                    {on && (
                      <span className="absolute right-1 top-1 rounded-sm bg-[#2b2118] px-1.5 py-0.5 text-[11px] font-bold tracking-[0.14em] text-[#e7b25c]">
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="border-t border-[#2b2118]/25 px-1.5 py-1">
                    <div className="text-[11px] font-bold tracking-[0.12em]">
                      {th.name.toUpperCase()}
                    </div>
                    <div className="text-[11px] leading-tight opacity-70">
                      {info ? info.blurb : "Procedurally stacked arena."}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* difficulty */}
        <div className="mt-3.5 [@media(max-height:760px)]:mt-2.5">
          <SectionLabel>{guest ? "DIFFICULTY · THE HOST PICKS" : "DIFFICULTY"}</SectionLabel>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {DIFFICULTY_IDS.map((d) => (
              <DifficultyCard
                key={d}
                id={d}
                on={difficulty === d}
                disabled={guest}
                onPick={() => !guest && pickDifficulty(d)}
              />
            ))}
          </div>
          <div className="mt-1 text-[11px] tracking-[0.1em] opacity-70">
            {DIFFICULTIES[difficulty].desc}
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
                    style={{ background: colorFor(p.num) }}
                  />
                  <span className="text-[11px] font-bold tracking-[0.15em]">
                    {p.num === 1 ? "HOST" : `P${p.num}`}
                    {p.me && <span className="opacity-70"> · YOU</span>}
                  </span>
                  <span className="ml-auto text-[11px] tracking-[0.12em] opacity-70">
                    {p.cls ? CLASSES[p.cls].name : "—"} ·{" "}
                    {p.ability ? ABILITIES[p.ability].name : "—"}
                  </span>
                  {p.ready ? (
                    <span className="rounded bg-[#1d7a37] px-1.5 py-0.5 text-[11px] font-bold tracking-[0.12em] text-[#f7eeda]">
                      READY
                    </span>
                  ) : (
                    <span className="rounded bg-[#2b2118]/15 px-1.5 py-0.5 text-[11px] font-bold tracking-[0.12em] opacity-70">
                      PICKING
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* footer — sticky on small screens so the primary action is always visible */}
        <div
          className={`mt-4 flex items-center gap-2 border-t-2 border-[#2b2118]/20 pt-3.5 [@media(max-height:760px)]:mt-2.5 [@media(max-height:760px)]:pt-2.5 ${
            compact ? "sticky bottom-0 -mx-3 -mb-3 bg-[#f3e6cf] px-3 pb-3" : ""
          }`}
        >
          {guest ? (
            <>
              <MenuButton
                variant={ready ? "primary" : "ink"}
                size={compact ? "md" : "lg"}
                className="flex-1"
                onClick={() => onReady(!ready)}
              >
                {ready ? "READY ✓" : "READY UP"}
              </MenuButton>
              <MenuButton variant="line" size={compact ? "md" : "lg"} onClick={onBack}>
                Back to lobby
              </MenuButton>
              {!ready && (
                <span className="text-[11px] tracking-[0.12em] opacity-70">
                  THE HOST STARTS THE MATCH
                </span>
              )}
            </>
          ) : (
            <>
              <MenuButton
                data-pad-start
                variant="primary"
                size={compact ? "md" : "lg"}
                className="flex-1"
                onClick={onEnter}
              >
                Enter arena
              </MenuButton>
              {multiplayer && (
                <span className="whitespace-nowrap text-[11px] tracking-[0.15em] opacity-70">
                  {players.filter((p) => p.ready).length}/{players.length} READY
                </span>
              )}
            </>
          )}
        </div>
      </Panel>
    </Scrim>
  );
}
