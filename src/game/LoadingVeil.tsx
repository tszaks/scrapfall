// The loading veil: an opaque ink backdrop over the canvas while a world is generated and
// warmed behind it — first paint, map picks in the loadout, hosting a room, and New Arena
// all pass through it. It is mounted before every menu and is pointer-transparent, so it
// never gates the UI on the backdrop being ready; the menus stay usable and only Enter
// Arena waits for the build. The slim progress line sits at the bottom edge (the title
// screen carries the logo itself) and animates on the compositor, so it stays smooth while
// the main thread is in the generator. Fades out once the map's shaders are warm.
import { C, Hazard } from "./ui/kit";

export function LoadingVeil({
  up,
  mapName,
  progress,
}: {
  /** true while the world on screen is being built or warmed */
  up: boolean;
  /** the incoming map's name */
  mapName: string;
  /** 0..1: staged real progress (build scheduled → built → shaders warm) */
  progress: number;
}) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div
      data-veil
      aria-hidden={!up}
      className="ui-root pointer-events-none fixed inset-0 font-mono"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 30%, #2b2118 0%, #161009 68%, #0e0a06 100%)",
        opacity: up ? 1 : 0,
        visibility: up ? "visible" : "hidden",
        transition: up
          ? "opacity 0.22s ease-out"
          : "opacity 0.6s ease-in, visibility 0s linear 0.6s",
      }}
    >
      <style>{`@keyframes veil-sheen { from { transform: translateX(-110%) } to { transform: translateX(320%) } }`}</style>
      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-6">
        <div className="w-[min(22rem,72vw)]">
          <div className="flex items-baseline justify-between text-[11px] font-bold tracking-[0.3em]">
            <span className="text-[#f3e6cf]/60">ENTERING</span>
            <span className="text-[#e7b25c]">{mapName.toUpperCase()}</span>
          </div>
          <div
            className="relative mt-2 h-[3px] w-full overflow-hidden rounded-full"
            style={{ background: `${C.paper}22` }}
          >
            <div
              className="absolute inset-y-0 left-0 w-full origin-left rounded-full"
              style={{
                background: C.gold,
                transform: `scaleX(${p})`,
                transition: "transform 0.35s ease-out",
              }}
            />
            <div
              className="absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${C.cream}88, transparent)`,
                animation: "veil-sheen 1.6s ease-in-out infinite",
              }}
            />
          </div>
          <Hazard className="mx-auto mt-2 w-16 opacity-60" />
        </div>
      </div>
    </div>
  );
}
