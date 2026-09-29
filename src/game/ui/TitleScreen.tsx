// Home screen in his exact style: SCRAPFALL over the live map, main menu, co-op lobby.
import { useState, type ReactNode } from "react";
import { Hazard, MenuButton, Scrim, SectionLabel, useViewport } from "@/bro/game/ui/kit";
import { BrandLogo } from "./BrandLogo";

export type LobbyPlayer = {
  num: number;
  cls: string | undefined;
  clsColor?: string;
  ability: string | undefined;
  color: string;
  me: boolean;
};

/** labelled box grouping secondary actions on the dark scrim */
function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border-2 border-[#f3e6cf]/25 bg-[#161009]/45 p-2.5 backdrop-blur-[2px]">
      <div className="mb-2 text-[11px] font-bold tracking-[0.3em] text-[#f3e6cf]/70">{label}</div>
      <div className="flex items-stretch gap-1.5">{children}</div>
    </div>
  );
}

/** key chips describing the controls for this device */
function ControlsHint({ touch }: { touch: boolean }) {
  const items = touch
    ? ["LEFT THUMB · MOVE", "RIGHT THUMB · AIM", "FIRE · SHOOT", "BUTTONS UP TOP"]
    : ["WASD · MOVE", "MOUSE · AIM", "CLICK · FIRE", "P · PAUSE"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((s) => (
        <span
          key={s}
          className="rounded border border-[#f3e6cf]/35 bg-[#161009]/45 px-2 py-1 text-[11px] font-bold tracking-[0.18em] text-[#f3e6cf]/85"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function PlayerRow({ p }: { p: LobbyPlayer }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-[#f3e6cf]/20 bg-[#f3e6cf]/6 px-3 py-2">
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-[3px] border border-[#2b2118]"
        style={{ background: p.color }}
      />
      <span className="w-[96px] shrink-0 whitespace-nowrap text-[11px] font-bold tracking-[0.12em]">
        {p.num === 1 ? "HOST" : `PLAYER ${p.num}`}
        {p.me && <span className="opacity-70"> · YOU</span>}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-[11px] font-bold tracking-[0.12em]">
        <span style={{ color: p.clsColor }}>{p.cls ?? "—"}</span>
        <span className="opacity-70"> · {p.ability ?? "CHOOSING…"}</span>
      </span>
    </div>
  );
}

export function TitleScreen({
  themeName,
  weather,
  touchUi,
  version,
  primaryLabel,
  onPlay,
  onSettings,
  onWeapons,
  net,
  joining,
  joinCode,
  setJoinCode,
  netError,
  startHost,
  startJoin,
  leaveRoom,
  players,
  mapPicker,
}: {
  themeName: string;
  weather: string;
  touchUi: boolean;
  version: string;
  primaryLabel: string;
  onPlay: () => void;
  onSettings: () => void;
  onWeapons: () => void;
  net: { role: "host" | "guest"; code: string } | null;
  joining: boolean;
  joinCode: string;
  setJoinCode: (v: string) => void;
  netError: string;
  startHost: () => void;
  startJoin: () => void;
  leaveRoom: () => void;
  players: LobbyPlayer[];
  mapPicker?: ReactNode;
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
  const inRoom = net !== null;
  const isHost = !net || net.role === "host";

  return (
    <Scrim className="ui-root flex touch-auto flex-col overflow-y-auto overscroll-contain">
      {/* top strip: studio + version + live map name */}
      <div
        className={`flex items-center justify-between px-5 pt-4 text-[11px] font-bold tracking-[0.3em] text-[#f3e6cf]/70 sm:px-8 ${compact ? "pt-2.5" : ""}`}
        style={{ textShadow: "0 1px 0 #2b2118" }}
      >
        <span>SZAKACS MEDIA</span>
        <span className="hidden sm:inline">SCRAPFALL · v{version}</span>
        <span>{themeName.toUpperCase()} · LIVE MAP</span>
      </div>

      <div
        className={`mx-auto flex w-full max-w-6xl flex-1 items-center px-5 sm:px-8 ${compact ? "py-1" : "py-6"}`}
      >
        <div className={`w-full ${narrow ? "" : "max-w-[30rem]"} ui-rise`}>
          <BrandLogo compact={compact} />

          {!inRoom ? (
            <>
              <div
                className={`${compact ? "mt-3" : "mt-7"} flex max-w-xs flex-col ${compact ? "gap-2" : "gap-2.5"} ui-rise-1`}
              >
                <MenuButton variant="primary" size={compact ? "md" : "lg"} onClick={onPlay}>
                  {primaryLabel}
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
                      className="pointer-events-auto w-full min-w-0 rounded-md border-2 border-[#f3e6cf]/35 bg-[#161009]/45 px-2 py-1.5 text-center text-xs font-bold tracking-[0.4em] text-[#f3e6cf] placeholder:text-[#f3e6cf]/70 focus:border-[#e7b25c] focus:outline-none"
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
                </div>
              </div>
              {netError && (
                <div className="mt-3 max-w-xs rounded-md border border-[#ffb4a8]/60 bg-[#b3261e]/25 px-3 py-2 text-[11px] font-bold tracking-widest text-[#ffd9d4]">
                  {netError}
                </div>
              )}
              <div className={`ui-rise-2 ${compact ? "mt-3" : "mt-4"}`}>
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
                  <span className="text-[11px] tracking-[0.2em] text-[#f3e6cf]/70">
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
                  <span className="text-[11px] font-bold tracking-[0.2em] text-[#e7b25c]">
                    {copied ? "COPIED ✓" : "TAP TO COPY"}
                  </span>
                </button>
                <div className="mt-1 text-[11px] tracking-[0.18em] text-[#f3e6cf]/70">
                  {net.role === "host"
                    ? "SHARE THE CODE — FRIENDS JOIN FROM THE TITLE SCREEN"
                    : "THE HOST PICKS THE MAP"}
                </div>
                <div className="mt-3 space-y-1.5">
                  {players.map((p) => (
                    <PlayerRow key={p.num} p={p} />
                  ))}
                  {Array.from({ length: Math.max(0, 4 - players.length) }, (_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-md border border-dashed border-[#f3e6cf]/20 px-3 py-2 text-[11px] tracking-[0.18em] text-[#f3e6cf]/70"
                    >
                      <span className="inline-block h-3 w-3 rounded-[3px] border border-[#f3e6cf]/25" />
                      OPEN SLOT
                    </div>
                  ))}
                </div>
                {mapPicker && <div className="mt-3">{mapPicker}</div>}
                <div className="mt-3.5 flex gap-2">
                  {isHost ? (
                    <MenuButton variant="primary" size="md" className="flex-1" onClick={onPlay}>
                      {primaryLabel}
                    </MenuButton>
                  ) : (
                    <MenuButton variant="ink" size="md" className="flex-1" onClick={onPlay}>
                      Loadout
                    </MenuButton>
                  )}
                  <MenuButton variant="ghost" size="md" onClick={leaveRoom}>
                    Leave
                  </MenuButton>
                </div>
                {!isHost && (
                  <div className="mt-2 text-center text-[11px] tracking-[0.2em] text-[#f3e6cf]/70">
                    WAITING FOR THE HOST TO START
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <MenuButton variant="line" size="sm" className="flex-1" onClick={onSettings}>
                    Settings
                  </MenuButton>
                  <MenuButton variant="line" size="sm" className="flex-1" onClick={onWeapons}>
                    Weapons
                  </MenuButton>
                </div>
                {netError && (
                  <div className="mt-3 rounded-md border border-[#ffb4a8]/60 bg-[#b3261e]/25 px-3 py-2 text-[11px] font-bold tracking-widest text-[#ffd9d4]">
                    {netError}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* footer strip: weather + credits */}
      <div
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 text-[11px] font-bold tracking-[0.25em] text-[#f3e6cf]/70 sm:px-8 ${compact ? "pb-2" : "pb-4"}`}
        style={{ textShadow: "0 1px 0 #2b2118" }}
      >
        <span className="hidden md:inline">{weather.toUpperCase()}</span>
        <span>TYLER &amp; TOBY SZAKACS · SZAKACS MEDIA</span>
      </div>
      {!touchUi && <Hazard className="mx-5 mb-2 hidden" />}
    </Scrim>
  );
}
