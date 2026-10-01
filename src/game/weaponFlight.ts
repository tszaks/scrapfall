/** Player weapon flight in metres and seconds. Explosives retain their readable arcs.
 * The same life is handed to co-op visual replay; speed is carried in the fire event.
 * Ranges are explicit so increasing speed cannot extend a round across the whole map.
 */
const flight = (speed: number, range: number) => ({ speed, life: range / speed });
export const FLIGHT = {
  sniper: flight(600, 420),
  pistol: flight(300, 90),
  scatter: flight(250, 24),
  smg: flight(350, 90),
  rail: flight(160, 120),
  cannon: flight(13, 39),
  rebound: flight(20, 60),
  harpoon: flight(80, 80),
  cryo: flight(110, 65),
  flak: flight(16, 32),
  tesla: flight(140, 70),
  revolver: flight(400, 120),
  minigun: flight(450, 120),
  crossbow: flight(90, 88),
  plasma: flight(120, 65),
  voidorb: flight(8, 32),
  shatter: flight(18, 32.4),
} as const;
