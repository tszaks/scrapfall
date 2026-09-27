import {
  setArenaSize,
  generateLevel,
  solidGrid,
  flowField,
  toNav,
  BEACH_SIZE,
} from "../src/game/level";
const [x0, x1, z0, z1] = (process.argv[2] ?? "-240,-110,-24,24").split(",").map(Number);
setArenaSize(BEACH_SIZE, 2);
const lv = generateLevel(1000, "beach", true);
const city = lv.city!;
const n = city.cells,
  half = city.half;
console.log("fine (#=solid, .=open), rows = z, cols = x");
for (let z = z0!; z < z1!; z += 2) {
  let row = String(z).padStart(5) + " ";
  for (let x = x0!; x < x1!; x += 2) {
    const c = Math.floor((x + half) / 2) * n + Math.floor((z + half) / 2);
    row += city.solid[c] ? "#" : ".";
  }
  console.log(row);
}
const nav = solidGrid(lv.blocks);
const dist = flowField(nav, toNav(city.spawn.x), toNav(city.spawn.z));
console.log("nav (#=solid, o=open reachable, x=open unreachable)");
for (let z = z0!; z < z1!; z += 4) {
  let row = String(z).padStart(5) + " ";
  for (let x = x0!; x < x1!; x += 4) {
    const k = toNav(x) * nav.n + toNav(z);
    row += nav.g[k] ? "#" : isFinite(dist[k]!) ? "o" : "x";
  }
  console.log(row);
}
