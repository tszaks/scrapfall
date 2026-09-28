import { Vector4 } from "three";
import { structureList } from "./world";

// Roof clipping keeps precipitation outside while remaining visible through real windows.
const MAX_SHELTERS = 32;
export function shelterUniforms() {
  const plans = structureList();
  const rooms = [
    ...plans
      .filter((p) => p.kind !== "colonnade")
      .map((p) => ({
        bounds: p.bounds,
        top:
          p.kind === "garage" || p.kind === "frame" ? Math.max(...p.floors.map((f) => f.y)) : p.top,
      })),
    ...plans
      .filter((p) => p.kind === "colonnade")
      .flatMap((p) =>
        p.solids
          .filter((v) => v.y1 > 2.5 && (v.x1 - v.x0) * (v.z1 - v.z0) > 10)
          .map((v) => ({ bounds: v, top: v.y1 })),
      ),
  ].slice(0, MAX_SHELTERS);
  return {
    uShelterCount: { value: rooms.length },
    uShelters: {
      value: Array.from({ length: MAX_SHELTERS }, (_, i) => {
        const p = rooms[i];
        return p ? new Vector4(p.bounds.x0, p.bounds.z0, p.bounds.x1, p.bounds.z1) : new Vector4();
      }),
    },
    uShelterY: {
      value: new Float32Array(Array.from({ length: MAX_SHELTERS }, (_, i) => rooms[i]?.top ?? 0)),
    },
  };
}
export const SHELTER_GLSL = /* glsl */ `
uniform int uShelterCount;
uniform vec4 uShelters[32];
uniform float uShelterY[32];
float outsideShelter(vec3 p) {
  for (int i=0;i<32;i++) {
    if(i>=uShelterCount) break;
    vec4 b=uShelters[i];
    if(p.x>b.x && p.z>b.y && p.x<b.z && p.z<b.w && p.y<uShelterY[i]) return 0.0;
  }
  return 1.0;
}
`;
