import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Car-profile battery capacity handed to the head unit on the command poll, so the APK's
 * on-car AI Range (a port of range-estimate.ts) uses the same capacity the web does
 * (`selectedCar.battery_capacity_kwh`). The car cannot read it itself: di+ reports a
 * meaningless BatCapacity (e.g. 4.2) and the app has no settings screen, so without this
 * it falls back to a 72.9 kWh default — a ~1.6x overstated range on a 45 kWh Yuan Up.
 *
 * Same plausibility band as range-estimate.ts; anything outside it is not sent.
 */
const MIN_PLAUSIBLE_BATTERY_KWH = 10;
const MAX_PLAUSIBLE_BATTERY_KWH = 200;

export type CarCapacityRow = {
  vehicle_alias: string | null;
  battery_capacity_kwh: number | string | null;
};

function plausibleCapacity(row: CarCapacityRow): number | null {
  const kwh = Number(row.battery_capacity_kwh);
  return Number.isFinite(kwh) &&
    kwh >= MIN_PLAUSIBLE_BATTERY_KWH &&
    kwh <= MAX_PLAUSIBLE_BATTERY_KWH
    ? kwh
    : null;
}

/**
 * The car row for this vehicle: the one whose `vehicle_alias` matches, else the account's
 * only car when it carries no alias (a single-car account never had to link one). A lone
 * car aliased to a *different* vehicle is not this vehicle and yields null.
 */
export function pickVehicleBatteryCapacityKwh(
  rows: readonly CarCapacityRow[],
  vehicleId: string,
): number | null {
  const aliased = rows.find((row) => row.vehicle_alias === vehicleId);
  if (aliased) return plausibleCapacity(aliased);
  if (rows.length === 1 && !rows[0].vehicle_alias)
    return plausibleCapacity(rows[0]);
  return null;
}

/** Best-effort: a lookup failure omits the field rather than failing the poll. */
export async function fetchVehicleBatteryCapacityKwh(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("cars")
    .select("vehicle_alias, battery_capacity_kwh")
    .eq("user_id", userId)
    .limit(20);
  if (error || !data) return null;
  return pickVehicleBatteryCapacityKwh(data as CarCapacityRow[], vehicleId);
}
