import { Vector3 } from "three";
import { staticRayContact } from "./staticCollision";
import { terrainY } from "./terrain";
const end = new Vector3();
/** Ping the rendered surface at the aimed height, not an infinitely tall map cell. */
export function pingSurface(origin: Vector3, direction: Vector3, range: number) {
  end.copy(origin).addScaledVector(direction, range);
  const hit = staticRayContact(origin, end);
  let distance = hit === undefined ? range : hit * range;
  let found = hit !== undefined;
  for (let d = 0.5; d <= distance; d += 0.5) {
    const x = origin.x + direction.x * d,
      z = origin.z + direction.z * d;
    if (origin.y + direction.y * d <= terrainY(x, z)) {
      distance = d;
      found = true;
      break;
    }
  }
  return found
    ? {
        x: origin.x + direction.x * distance,
        y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance,
      }
    : null;
}
