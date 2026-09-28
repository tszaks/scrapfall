// Dry Gulch's own enemies: the DESPERADO (the map's special: poncho, sombrero, twin
// revolvers, a quick-draw telegraph and then a fast double shot) and THE IRON MARSHAL (the
// boss: a steam-powered robot sheriff with a Gatling arm and a lasso, who arrives by train).
// Both models now live in art/robots (specials.ts / bosses.ts, drawn via art/SpecialBoss.tsx);
// the behaviour hooks are called from the game's enemy loop so every rule stays next to the others.
import { ArtDesperado } from "../art/SpecialBoss";
import type { RobotData } from "../art/RobotModel";

type Colors = { body: string; accent: string; glow: string };

/** The Desperado: a gunslinger robot in a striped poncho and a wide sombrero. `drawing`
 * (the synced aux flag) raises both revolvers and flashes the glint before it fires. The
 * detailed skinned model lives in art/robots/specials.ts. */
export function DesperadoModel({ sp, data }: { sp: Colors; data: RobotData }) {
  return <ArtDesperado sp={sp} data={data} />;
}
