// The home screen: SCRAPFALL over the live map, the main menu, and — once a room is open —
// the co-op lobby (room code, the squad's classes and ready states).
import { useState, type ReactNode } from "react";
import { ABILITIES, type AbilityId } from "../abilities";
import { CLASSES, type ClassId } from "../classes";
import { colorFor } from "../net";
import { useInputDevice } from "../input/useInputDevice";
import { C, Hazard, Logo, MenuButton, Scrim, SectionLabel, useViewport } from "./kit";

export type LobbyPlayer = {
  num: number;
  cls: ClassId | undefined;
  ability: AbilityId | undefined;
  ready: boolean;
  me: boolean;
};

/** labelled box grouping secondary actions on the dark scrim */
function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border-2 border-[#f3e6cf]/25 bg-[#161009]/45 p-2.5 backdrop-blur-[2px]">
      <div className="mb-2 text-[9px] font-bold tracking-[0.3em] text-[#f3e6cf]/60">{label}</div>
      <div className="flex items-stretch gap-1.5">{children}</div>
    </div>
  );
}

/** three key chips describing the controls for whatever device was used last */
function ControlsHint({ touch }: { touch: boolean }) {
  const d = useInputDevice();
  const items =
    d.kind === "pad"
      ? ["LEFT STICK · MOVE", "RIGHT STICK · AIM", "TRIGGER · FIRE", "D-PAD · MENUS"]
      : touch
        ? ["LEFT THUMB · MOVE", "RIGHT THUMB · AIM", "FIRE · SHOOT", "BUTTONS UP TOP"]
        : ["WASD · MOVE", "MOUSE · AIM", "CLICK · FIRE", "P · PAUSE"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span
          key={s}
          className="rounded border border-[#f3e6cf]/35 bg-[#161009]/45 px-2 py-1 text-[9px] font-bold tracking-[0.18em] text-[#f3e6cf]/85"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function PlayerRow({ p, showReady }: { p: LobbyPlayer; showReady: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-[#2b2118]/25 bg-[#2b2118]/6 px-3 py-2">
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-[3px] border border-[#2b2118]"
        style={{ background: colorFor(p.num) }}
      />
      <span className="w-[96px] shrink-0 whitespace-nowrap text-[11px] font-bold tracking-[0.12em]">
        {p.num === 1 ? "HOST" : `PLAYER ${p.num}`}
        {p.me && <span className="opacity-45"> · YOU</span>}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-[9px] font-bold tracking-[0.12em]">
        {p.cls ? CLASSES[p.cls].name : "—"}
        <span className="opacity-55"> · {p.ability ? ABILITIES[p.ability].name : "NO ABILITY"}</span>
      </span>
      {showReady &&
        (p.ready ? (
          <span className="w-14 shrink-0 rounded bg-[#1d7a37] px-1.5 py-0.5 text-center text-[9px] font-bold tracking-[0.12em] text-[#f7eeda]">
            READY
          </span>
        ) : (
          <span className="w-14 shrink-0 rounded bg-[#2b2118]/15 px-1.5 py-0.5 text-center text-[9px] font-bold tracking-[0.12em] opacity-70">
            PICKING
          </span>
        ))}
    </div>
  );
}

export function TitleScreen({
  themeName,
  weather,
  touchUi,
  onPlay,
  onSettings,
  onWeapons,
  onEnemies,
  net,
  joining,
  joinCode,
  setJoinCode,
  netError,
  startHost,
  startJoin,
  leaveRoom,
  players,
  ready,
  onReady,
  version,
}: {
  themeName: string;
  weather: string;
  touchUi: boolean;
  onPlay: () => void;
  onSettings: () => void;
  onWeapons: () => void;
  onEnemies: () => void;
  net: { role: "host" | "guest"; code: string } | null;
  joining: boolean;
  joinCode: string;
  setJoinCode: (v: string) => void;
  netError: string;
  startHost: () => void;
  startJoin: () => void;
  leaveRoom: () => void;
  players: LobbyPlayer[];
  ready: boolean;
  onReady: (v: boolean) => void;
  version: string;
}) {
  const { short, narrow } = useViewport();
  const compact = short || touchUi;
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    if (!net) return;
    try {
      await navigator.clipboard.writeText(net.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — the code is right there anyway */
    }
  };
  const readyCount = players.filter((p) => p.ready).length;
  const inRoom = net !== null;
  const isHost = !net || net.role === "host";

  return (
    <Scrim className="ui-root flex touch-auto flex-col overflow-y-auto overscroll-contain">
      {/* top strip: studio + version + live map name */}
      <div
        className={`flex items-center justify-between px-5 pt-4 text-[9px] font-bold tracking-[0.3em] text-[#f3e6cf]/70 sm:px-8 ${compact ? "pt-2.5" : ""}`}
        style={{ textShadow: "0 1px 0 #2b2118" }}
      >
        <span>SZAKACS MEDIA</span>
        <span className="hidden sm:inline">SCRAPFALL · v{version}</span>
        <span>{themeName.toUpperCase()} · LIVE MAP</span>
      </div>

      <div
        className={`mx-auto flex w-full max-w-6xl flex-1 items-center px-5 sm:px-8 ${compact ? "py-2" : "py-6"}`}
      >
        <div className={`w-full ${narrow ? "" : "max-w-[30rem]"} ui-rise`}>
          <Logo compact={compact} />

          {!inRoom ? (
            <>
              <div
                className={`${compact ? "mt-4" : "mt-7"} flex max-w-xs flex-col gap-2.5 ui-rise-1`}
              >
                <MenuButton
                  data-pad-start
                  variant="primary"
                  size={compact ? "md" : "lg"}
                  onClick={onPlay}
                >
                  Start
                </MenuButton>
                <MenuGroup label="CO-OP · UP TO 4 PLAYERS">
                  <MenuButton
                    variant="ink"
                    size="sm"
                    className="flex-1"
                    onClick={startHost}
                    disabled={joining}
                  >
                    {joining ? "OPENING…" : "HOST A ROOM"}
                  </MenuButton>
                  <div className="flex min-w-0 flex-1 items-stretch gap-1.5">
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
                      onKeyDown={(e) => e.key === "Enter" && startJoin()}
                      placeholder="CODE"
                      aria-label="Room code"
                      className="pointer-events-auto w-full min-w-0 rounded-md border-2 border-[#f3e6cf]/35 bg-[#161009]/45 px-2 py-1.5 text-center text-xs font-bold tracking-[0.4em] text-[#f3e6cf] placeholder:text-[#f3e6cf]/30 focus:border-[#e7b25c] focus:outline-none"
                    />
                    <MenuButton
                      variant="ink"
                      size="sm"
                      onClick={startJoin}
                      disabled={joining || joinCode.trim().length < 4}
                    >
                      JOIN
                    </MenuButton>
                  </div>
                </MenuGroup>
                <div className="flex gap-2">
                  <MenuButton variant="line" size="sm" className="flex-1" onClick={onSettings}>
                    Settings
                  </MenuButton>
                  <MenuButton variant="line" size="sm" className="flex-1" onClick={onWeapons}>
                    Weapons
                  </MenuButton>
                  <MenuButton variant="line" size="sm" className="flex-1" onClick={onEnemies}>
                    Enemies
                  </MenuButton>
                </div>
              </div>
              {netError && (
                <div className="mt-3 max-w-xs rounded-md border border-[#ffb4a8]/60 bg-[#b3261e]/25 px-3 py-2 text-[10px] font-bold tracking-widest text-[#ffd9d4]">
                  {netError}
                </div>
              )}
              <div className="ui-rise-2 mt-4">
                <ControlsHint touch={touchUi} />
              </div>
            </>
          ) : (
            /* ---------- co-op lobby ---------- */
            <div className={`${compact ? "mt-4" : "mt-6"} max-w-sm ui-rise-1`}>
              <div className="rounded-lg border-2 border-[#f3e6cf]/25 bg-[#161009]/55 p-4 backdrop-blur-[2px]">
                <div className="flex items-baseline justify-between">
                  <SectionLabel className="text-[#e7b25c] opacity-90">
                    {net.role === "host" ? "HOSTING ROOM" : "JOINED ROOM"}
                  </SectionLabel>
                  <span className="text-[9px] tracking-[0.2em] text-[#f3e6cf]/60">
                    {players.length}/4
                  </span>
                </div>
                <button
                  onClick={copyCode}
                  title="Copy room code"
                  className="pointer-events-auto mt-1.5 flex w-full items-center justify-between rounded-md border-2 border-[#e7b25c]/70 bg-[#2b2118]/70 px-3 py-2 text-left"
                >
                  <span className="text-2xl font-black tracking-[0.42em] text-[#f7eeda]">
                    {net.code}
                  </span>
                  <span className="text-[9px] font-bold tracking-[0.2em] text-[#e7b25c]">
                    {copied ? "COPIED ✓" : "TAP TO COPY"}
                  </span>
                </button>
                <div className="mt-1 text-[9px] tracking-[0.18em] text-[#f3e6cf]/60">
                  {net.role === "host"
                    ? "SHARE THE CODE — FRIENDS JOIN FROM THE TITLE SCREEN"
                    : "THE HOST PICKS THE MAP AND DIFFICULTY"}
                </div>
                <div className="mt-3 space-y-1.5">
                  {players.map((p) => (
                    <PlayerRow key={p.num} p={p} showReady={isHost} />
                  ))}
                  {Array.from({ length: Math.max(0, 4 - players.length) }, (_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-md border border-dashed border-[#f3e6cf]/20 px-3 py-2 text-[10px] tracking-[0.18em] text-[#f3e6cf]/35"
                    >
                      <span className="inline-block h-3 w-3 rounded-[3px] border border-[#f3e6cf]/25" />
                      OPEN SLOT
                    </div>
                  ))}
                </div>
                <div className="mt-3.5 flex gap-2">
                  {isHost ? (
                    <MenuButton
                      data-pad-start
                      variant="primary"
                      size="md"
                      className="flex-1"
                      onClick={onPlay}
                    >
                      Start
                    </MenuButton>
                  ) : (
                    <>
                      <MenuButton
                        variant={ready ? "primary" : "line"}
                        size="md"
                        className="flex-1"
                        onClick={() => onReady(!ready)}
                      >
                        {ready ? "READY ✓" : "READY UP"}
                      </MenuButton>
                      <MenuButton variant="ink" size="md" className="flex-1" onClick={onPlay}>
                        Loadout
                      </MenuButton>
                    </>
                  )}
                  <MenuButton variant="ghost" size="md" data-pad-back onClick={leaveRoom}>
                    Leave
                  </MenuButton>
                </div>
                {isHost && (
                  <div className="mt-2 text-center text-[9px] tracking-[0.2em] text-[#f3e6cf]/55">
                    {readyCount}/{players.length} READY — YOU CAN START ANY TIME
                  </div>
                )}
                {netError && (
                  <div className="mt-3 rounded-md border border-[#ffb4a8]/60 bg-[#b3261e]/25 px-3 py-2 text-[10px] font-bold tracking-widest text-[#ffd9d4]">
                    {netError}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* footer strip: weather rule + credits */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 pb-4 text-[9px] font-bold tracking-[0.25em] text-[#f3e6cf]/70 sm:px-8"
        style={{ textShadow: "0 1px 0 #2b2118" }}
      >
        <span className="hidden md:inline">{weather.toUpperCase()}</span>
        <span>TYLER &amp; TOBY SZAKACS · SZAKACS MEDIA</span>
      </div>
    </Scrim>
  );
}
