/** A deliberate controller hold enters one specific car once, until the button is released. */
export const CAR_ENTRY_SECONDS = 0.65;
export const vehicleEntry = { target: "", progress: 0, blocked: false, requested: "" };
export function resetVehicleEntry() {
  vehicleEntry.target = "";
  vehicleEntry.progress = 0;
  vehicleEntry.requested = "";
  vehicleEntry.blocked = true;
}
export function stepVehicleEntry(dt: number, target: string, held: boolean, pressed: boolean) {
  if (!held) {
    vehicleEntry.target = "";
    vehicleEntry.progress = 0;
    vehicleEntry.requested = "";
    vehicleEntry.blocked = false;
    return false;
  }
  if (vehicleEntry.target && vehicleEntry.target !== target) resetVehicleEntry();
  if (vehicleEntry.blocked) return false;
  if (pressed && target) vehicleEntry.target = target;
  if (!target || vehicleEntry.target !== target) return false;
  vehicleEntry.progress = Math.min(
    1,
    vehicleEntry.progress + Math.min(dt, 0.1) / CAR_ENTRY_SECONDS,
  );
  if (vehicleEntry.progress < 1) return false;
  vehicleEntry.requested = target;
  vehicleEntry.blocked = true;
  return true;
}

const approachSpeed = (speed: number, target: number, rate: number, dt: number) =>
  speed + Math.max(-rate * dt, Math.min(rate * dt, target - speed));

/** Brake pressure only reduces speed to zero; reverse remains an explicit signed throttle. */
export function vehicleSpeed(
  speed: number,
  gas: number,
  brake: number,
  topSpeed: number,
  dt: number,
) {
  gas = Math.max(-1, Math.min(1, Number.isFinite(gas) ? gas : 0));
  brake = Math.max(0, Math.min(1, Number.isFinite(brake) ? brake : 0));
  if (brake > 0) return approachSpeed(speed, 0, 18 * brake + 1.2, dt);
  if (Math.abs(gas) < 0.02) return approachSpeed(speed, 0, 1.2 + Math.abs(speed) * 0.035, dt);
  if (speed * gas < 0) return approachSpeed(speed, 0, 14 * Math.abs(gas), dt);
  return approachSpeed(speed, topSpeed * gas, 6 * Math.abs(gas), dt);
}

/** Vehicles face +Z; positive input is the driver's right (-X at yaw zero). */
export function vehicleTurn(yaw: number, steer: number, speed: number, dt: number) {
  return yaw - steer * dt * 1.5 * Math.min(1, Math.abs(speed) / 3) * Math.sign(speed);
}
