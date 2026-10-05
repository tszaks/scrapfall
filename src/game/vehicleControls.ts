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

/** Opposing pedals stop first; a continued hold accelerates in the requested direction. */
export function vehicleSpeed(
  speed: number,
  gas: number,
  brake: number,
  topSpeed: number,
  dt: number,
  brakeOnly = false,
) {
  gas = Math.max(-1, Math.min(1, Number.isFinite(gas) ? gas : 0));
  brake = Math.max(0, Math.min(1, Number.isFinite(brake) ? brake : 0));
  if (brakeOnly || (gas > 0.02 && brake > 0.02))
    return approachSpeed(speed, 0, 18 * (brakeOnly ? 1 : brake) + 1.2, dt);
  const pedal = brake > 0.02 ? -Math.max(brake, -gas) : gas;
  if (Math.abs(pedal) < 0.02) return approachSpeed(speed, 0, 1.2 + Math.abs(speed) * 0.035, dt);
  // Never spend the remainder of a braking frame accelerating the other way.
  if (speed * pedal < 0) return approachSpeed(speed, 0, 18 * Math.abs(pedal) + 1.2, dt);
  const limit = pedal < 0 ? Math.min(8, topSpeed * 0.35) : topSpeed;
  return approachSpeed(speed, limit * pedal, (pedal < 0 ? 3.5 : 6) * Math.abs(pedal), dt);
}

/** Vehicles face +Z; positive input is the driver's right (-X at yaw zero). */
export function vehicleTurn(yaw: number, steer: number, speed: number, dt: number) {
  return yaw - steer * dt * 1.5 * Math.min(1, Math.abs(speed) / 3) * Math.sign(speed);
}
