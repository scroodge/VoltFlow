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
  /** cars.range_reserve_soc_percent; absent in rows selected before the reserve existed. */
  range_reserve_soc_percent?: number | string | null;
};

/**
 * Everything the APK's on-car AI Range needs from the car profile so it computes the same
 * number as `estimateVehicleRangeKm` on the web: capacity and the range reserve.
 */
export type VehicleRangeProfile = {
  batteryCapacityKwh: number | null;
  rangeReserveSocPercent: number | null;
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
function pickVehicleRow(
  rows: readonly CarCapacityRow[],
  vehicleId: string,
): CarCapacityRow | null {
  const aliased = rows.find((row) => row.vehicle_alias === vehicleId);
  if (aliased) return aliased;
  if (rows.length === 1 && !rows[0].vehicle_alias) return rows[0];
  return null;
}

export function pickVehicleBatteryCapacityKwh(
  rows: readonly CarCapacityRow[],
  vehicleId: string,
): number | null {
  const row = pickVehicleRow(rows, vehicleId);
  return row ? plausibleCapacity(row) : null;
}

/** Same 0–100 clamp `range-estimate.ts` applies; null when the column is missing or junk. */
function validReserve(row: CarCapacityRow): number | null {
  if (row.range_reserve_soc_percent == null) return null;
  const reserve = Number(row.range_reserve_soc_percent);
  return Number.isFinite(reserve) ? Math.min(100, Math.max(0, reserve)) : null;
}

export function pickVehicleRangeProfile(
  rows: readonly CarCapacityRow[],
  vehicleId: string,
): VehicleRangeProfile {
  const row = pickVehicleRow(rows, vehicleId);
  return {
    batteryCapacityKwh: row ? plausibleCapacity(row) : null,
    rangeReserveSocPercent: row ? validReserve(row) : null,
  };
}

/** JSON fields for the telemetry ack / command poll; each one omitted when unknown. */
export function vehicleRangeProfileFields(profile: VehicleRangeProfile | null): {
  battery_capacity_kwh?: number;
  range_reserve_soc_percent?: number;
} {
  if (!profile) return {};
  return {
    ...(profile.batteryCapacityKwh != null
      ? { battery_capacity_kwh: profile.batteryCapacityKwh }
      : {}),
    ...(profile.rangeReserveSocPercent != null
      ? { range_reserve_soc_percent: profile.rangeReserveSocPercent }
      : {}),
  };
}

/** Best-effort: a lookup failure omits the fields rather than failing the poll. */
export async function fetchVehicleRangeProfile(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<VehicleRangeProfile | null> {
  const { data, error } = await supabase
    .from("cars")
    .select("vehicle_alias, battery_capacity_kwh, range_reserve_soc_percent")
    .eq("user_id", userId)
    .limit(20);
  if (error || !data) return null;
  return pickVehicleRangeProfile(data as CarCapacityRow[], vehicleId);
}
