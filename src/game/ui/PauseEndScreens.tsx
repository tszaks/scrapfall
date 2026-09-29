// Pause and the end-of-run recap. Same paper card family as the title/loadout: one panel,
// a hazard rule, and a single rust primary action.
import { useState } from "react";
import { CLASSES, type ClassId } from "../classes";
import type { Derived } from "../perks";
import { colorFor } from "../net";
import { C, Hazard, MenuButton, Panel, Scrim, SectionLabel, useViewport } from "./kit";

export function PauseScreen({
  wave,
  totalWaves,
  score,
  difficultyName,
  stats,
  cls,
  bought,
  multiplayer,
  onResume,
  onSettings,
  onLeave,
}: {
  wave: number;
  totalWaves: number;
  score: number;
  difficultyName: string;
  stats: Derived;
  cls: ClassId;
  /** this run's bought shop cards, with what each does (Toby 1.0.3 stats overhaul) */
  bought: { id: string; name: string; lvl: number; color: string; mod: boolean; effects: { text: string; tone?: "good" | "bad" | "flat" }[] }[];
  multiplayer: boolean;
  onResume: () => void;
  onSettings: () => void;
  onLeave: () => void;
}) {
  const { short } = useViewport();
  const compact = short;
  return (
    <Scrim strong className="ui-root flex touch-auto items-center justify-center overflow-y-auto overscroll-contain p-4">
      <Panel className={`ui-rise my-auto w-full max-w-md ${compact ? "p-4" : "p-6"}`}>
        <SectionLabel>MATCH ON HOLD</SectionLabel>
        <h2 className={`font-black tracking-[0.12em] ${compact ? "text-xl" : "text-3xl"}`}>
          PAUSED
        </h2>
        <div className="mt-1.5 text-[11px] font-bold tracking-[0.2em] opacity-70">
          WAVE {wave}/{totalWaves} · {score} KILLS · {difficultyName}
        </div>
        <Hazard className="mt-3" />

        <div className={`flex flex-col gap-2 ${compact ? "mt-3" : "mt-4"}`}>
          <MenuButton data-pad-start variant="primary" size="md" onClick={onResume}>
            Resume
          </MenuButton>
          <div className="flex gap-2">
            <MenuButton variant="line" size="sm" className="flex-1" onClick={onSettings}>
              Settings
            </MenuButton>
            <MenuButton variant="ink" size="sm" className="flex-1" data-pad-back onClick={onLeave}>
              {multiplayer ? "Leave room" : "Leave game"}
            </MenuButton>
          </div>
        </div>

        {!compact && (
          <>
            <StatMini d={stats} cls={cls} />
            {bought.length > 0 && (
              <div className="mt-3">
                <SectionLabel>UPGRADES BOUGHT</SectionLabel>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {bought.map((c) => (
                    <div
                      key={c.id}
                      className="relative rounded-md border p-1.5"
                      style={{ borderColor: `${c.color}80`, background: `${c.color}14` }}
                    >
                      {c.mod && (
                        <span className="absolute right-1 top-1 rounded-sm bg-[#2b2118] px-1 text-[7px] font-bold tracking-widest text-[#f3e6cf]">
                          MOD
                        </span>
                      )}
                      <div className="pr-5 text-[9px] font-bold tracking-wider">{c.name}</div>
                      <div className="mt-0.5 space-y-0.5 text-[9px] leading-tight">
                        {c.effects.map((e, i) => (
                          <div
                            key={i}
                            className={
                              e.tone === "bad"
                                ? "font-bold text-[#b3261e]"
                                : e.tone === "good"
                                  ? "font-bold text-[#1d7a37]"
                                  : "opacity-70"
                            }
                          >
                            {e.text}
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 text-[9px] font-bold tracking-widest opacity-55">
                        x{c.lvl}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </Scrim>
  );
}

/** the pause screen's stat sheet: the same numbers as the old tabbed sheet, both groups at once */
function StatMini({ d, cls }: { d: Derived; cls: ClassId }) {
  const pct1 = (v: number): -1 | 0 | 1 => (v > 1 + 1e-6 ? 1 : v < 1 - 1e-6 ? -1 : 0);
  const pct0 = (v: number): -1 | 0 | 1 => (v > 1e-6 ? 1 : v < -1e-6 ? -1 : 0);
  const combat: [string, string, -1 | 0 | 1][] = [
    ["Firepower", `${Math.round(d.dmg * 100)}%`, pct1(d.dmg)],
    ["Cycle Rate", `${Math.round(d.rate * 100)}%`, pct1(d.rate)],
    ["Crit Protocol", `${Math.round(d.crit * 100)}%`, pct0(d.crit)],
    ["Piercing", `${d.pierce}`, pct0(d.pierce)],
    ["Ricochet", `${Math.round(d.ricochet * 100)}%`, pct0(d.ricochet)],
    ["Combustion", `${Math.round(d.boom * 100)}%`, pct0(d.boom)],
    ["Impact Force", `${Math.round(d.knock * 100)}%`, pct0(d.knock)],
    ["Ammo Capacity", `${Math.round(d.ammoMul * 100)}%`, pct1(d.ammoMul)],
  ];
  const survival: [string, string, -1 | 0 | 1][] = [
    ["Hull Integrity", `${d.maxHp}`, pct1(d.maxHp / 10)],
    ["Armor Plating", `${Math.round(d.armor * 100)}%`, pct0(d.armor)],
    ["Phase Shift", `${Math.round(d.dodge * 100)}%`, pct0(d.dodge)],
    ["Life Siphon", `${Math.round(d.steal * 100)}%`, pct0(d.steal)],
    ["Nano-Regen", d.regen ? `x${d.regen}` : "0", d.regen ? 1 : 0],
    ["Shock Thorns", `${Math.round(d.thorns * 100)}%`, pct0(d.thorns)],
    ["Thruster Speed", `${Math.round(d.speed * 100)}%`, pct1(d.speed)],
    ["Flux Magnet", `${d.magnet.toFixed(1)}m`, pct0(d.magnet - 2)],
    ["Salvage Yield", `${Math.round(d.greed * 100)}%`, pct1(d.greed)],
    ["Recharge Haste", `${Math.round(d.haste * 100)}%`, pct0(d.haste)],
    ["Free Rerolls", `${d.freeRerolls}`, pct0(d.freeRerolls)],
  ];
  const col = (rows: [string, string, -1 | 0 | 1][], title: string) => (
    <div>
      <div className="text-[11px] tracking-[0.3em] opacity-70">{title}</div>
      <div className="mt-1 space-y-0.5 text-[11px]">
        {rows.map(([l, v, t]) => (
          <div key={l} className="flex items-center justify-between gap-2">
            <span className={t === 1 ? "text-[#7cff4f]" : t === -1 ? "text-[#ff6b5e]" : "text-[#f3e6cf]/75"}>
              {l}
            </span>
            <span className={`font-bold ${t === 1 ? "text-[#7cff4f]" : t === -1 ? "text-[#ff6b5e]" : ""}`}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
  const [showCls, setShowCls] = useState(false);
  return (
    <div className="mt-4 rounded-lg bg-[#2b2118] p-3 font-mono text-[#f3e6cf]">
      <div className="flex items-center justify-between text-[11px] tracking-[0.25em]">
        <span className="opacity-70">STATS</span>
        {/* hover or tap shows the class's role and trade-offs (Toby's class popover) */}
        <span className="relative">
          <button
            onMouseEnter={() => setShowCls(true)}
            onMouseLeave={() => setShowCls(false)}
            onClick={() => setShowCls((v) => !v)}
            className="cursor-help underline decoration-dotted underline-offset-2"
            style={{ color: CLASSES[cls].color }}
          >
            {CLASSES[cls].name}
          </button>
          {showCls && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-[#f3e6cf]/20 bg-[#1d160f] p-2 text-left shadow-lg">
              <div className="text-[9px] tracking-[0.2em]" style={{ color: CLASSES[cls].color }}>
                {CLASSES[cls].name}
              </div>
              <div className="mt-0.5 text-[9px] opacity-60">{CLASSES[cls].role}</div>
              <div className="mt-1.5 text-[9px] tracking-[0.2em] opacity-50">STARTING STATS</div>
              <div className="mt-1 space-y-0.5 text-[10px]">
                {CLASSES[cls].pros.map((p) => (
                  <div key={p} className="text-[#7cff4f]">
                    {p}
                  </div>
                ))}
                {CLASSES[cls].cons.map((c) => (
                  <div key={c} className="text-[#ff6b5e]">
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4">
        {col(combat, "COMBAT")}
        {col(survival, "SURVIVAL")}
      </div>
    </div>
  );
}

export type RecapRow = {
  num: number;
  kills: number;
  dmg: number;
  acc: number;
  shards: number;
  taken: number;
};

export function EndScreen({
  won,
  wave,
  totalWaves,
  difficultyName,
  mine,
  rows,
  myNum,
  multiplayer,
  isHost,
  /** the run went past the last wave (the squad picked overtime before ending) */
  endless,
  /** deepest wave ever reached, kept in localStorage (Toby 1.0.4) */
  highWave,
  /** host only: push the run into endless overtime past the last wave */
  onOvertime,
  onNewArena,
  onLoadout,
  onLeave,
}: {
  won: boolean;
  wave: number;
  totalWaves: number;
  difficultyName: string;
  mine: RecapRow;
  rows: RecapRow[];
  myNum: number;
  multiplayer: boolean;
  isHost: boolean;
  endless?: boolean;
  highWave?: number;
  onOvertime?: () => void;
  onNewArena: () => void;
  onLoadout: () => void;
  onLeave: () => void;
}) {
  const { short } = useViewport();
  const compact = short;
  const badges: string[] = [];
  if (mine.acc >= 60) badges.push("SHARPSHOOTER");
  if (rows.length > 1) {
    if (mine.dmg > 0 && rows.every((x) => mine.dmg >= x.dmg)) badges.push("HEAVY GUNNER");
    if (mine.shards > 0 && rows.every((x) => mine.shards >= x.shards)) badges.push("SCAVENGER");
    if (rows.every((x) => mine.taken <= x.taken)) badges.push("IRON WILL");
  }
  if (won) badges.push("BOSS SLAYER");
  const stats: [string, string][] = [
    // a win that went into overtime counts the overtime waves survived, not the clean 12
    ["WAVES SURVIVED", `${won && !endless ? totalWaves : Math.max(0, wave - 1)}`],
    ...(highWave ? ([["BEST EVER", `WAVE ${highWave}`]] as [string, string][]) : []),
    ["KILLS", `${mine.kills}`],
    ["DAMAGE DEALT", `${mine.dmg}`],
    ["ACCURACY", `${mine.acc}%`],
    ["SHARDS COLLECTED", `${mine.shards}`],
    ["DAMAGE TAKEN", `${mine.taken}`],
  ];

  return (
    <Scrim strong className="ui-root flex touch-auto items-center justify-center overflow-y-auto overscroll-contain p-4">
      <Panel className={`ui-rise my-auto w-full max-w-md ${compact ? "p-4" : "p-6"}`}>
        <SectionLabel>{won ? "THE ARENA IS QUIET" : "RUN REPORT"}</SectionLabel>
        <h2
          className={`font-black tracking-[0.1em] ${compact ? "text-xl" : "text-3xl"}`}
          style={{ color: won ? C.leaf : C.blood }}
        >
          {won ? "ARENA CLEARED!" : "YOU GOT SWARMED"}
        </h2>
        <div className="mt-1.5 text-[11px] font-bold tracking-[0.18em] opacity-70">
          {won
            ? `ALL ${totalWaves} WAVES · ${mine.kills} KILLS · ${difficultyName}`
            : `WAVE ${wave} · ${mine.kills} KILLS · ${difficultyName}`}
        </div>
        <Hazard className="mt-3" />

        <div className={`grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] tracking-wider ${compact ? "mt-3" : "mt-4"}`}>
          {stats.map(([l, v]) => (
            <div key={l} className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] tracking-[0.18em] opacity-70">{l}</span>
              <span className="font-bold">{v}</span>
            </div>
          ))}
        </div>

        {badges.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span
                key={b}
                className="rounded border border-[#2b2118] bg-[#e7b25c]/50 px-2 py-0.5 text-[11px] font-bold tracking-[0.15em]"
              >
                ★ {b}
              </span>
            ))}
          </div>
        )}

        {multiplayer && rows.length > 1 && (
          <div className="mt-3.5">
            <SectionLabel>SQUAD</SectionLabel>
            <div className="mt-1.5 space-y-1">
              {rows.map((x) => (
                <div
                  key={x.num}
                  className="flex items-center gap-2 rounded border border-[#2b2118]/25 bg-[#2b2118]/6 px-2.5 py-1.5"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px] border border-[#2b2118]"
                    style={{ background: colorFor(x.num) }}
                  />
                  <span className="text-[11px] font-bold tracking-[0.15em]">
                    {x.num === 1 ? "HOST" : `P${x.num}`}
                    {x.num === myNum && <span className="opacity-70"> · YOU</span>}
                  </span>
                  <span className="ml-auto text-[11px] tracking-[0.1em] opacity-70">
                    {x.kills} KILLS · {x.dmg} DMG · {x.acc}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={`flex flex-col gap-2 ${compact ? "mt-3.5" : "mt-5"}`}>
          {/* beat the boss: bank the win, or the host pushes the run into overtime (Toby 1.0.4) */}
          {won && onOvertime && isHost && (
            <MenuButton variant="line" size="md" className="w-full" onClick={onOvertime}>
              Overtime // keep going
            </MenuButton>
          )}
          {multiplayer && !isHost ? (
            <>
              <div className="rounded-md border border-[#2b2118]/25 bg-[#2b2118]/8 px-4 py-2 text-center text-[11px] font-bold tracking-[0.2em] opacity-75">
                WAITING FOR THE HOST TO START A NEW ARENA
              </div>
              <MenuButton variant="ink" size="md" className="w-full" onClick={onLoadout}>
                Choose loadout
              </MenuButton>
            </>
          ) : (
            <MenuButton
              data-pad-start
              variant="primary"
              size="md"
              className="w-full"
              onClick={onNewArena}
            >
              New arena
            </MenuButton>
          )}
          <div className="flex gap-2">
            {multiplayer && !isHost && (
              <MenuButton variant="line" size="sm" className="flex-1" onClick={onLoadout}>
                Loadout
              </MenuButton>
            )}
            <MenuButton variant="ink" size="sm" className="flex-1" data-pad-back onClick={onLeave}>
              {multiplayer ? "Leave room" : "Leave game"}
            </MenuButton>
          </div>
        </div>
      </Panel>
    </Scrim>
  );
}
