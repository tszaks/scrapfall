import { groundY as bigY } from "@/bro/game/terrain";

let big = false;
/** On the copied big maps the ground has hills, decks and boardwalks; our arenas are flat. */
export function setBigGround(on: boolean) {
  big = on;
}
export function groundY(x: number, z: number) {
  return big ? bigY(x, z) : 0;
}
