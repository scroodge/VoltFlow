import { z } from "zod";

const numericSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    const numberValue = Number(trimmed);
    return Number.isFinite(numberValue) ? numberValue : value;
  }

  return value;
}, z.number().nullable().optional());

const booleanSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "") return null;
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return value;
}, z.boolean().nullable().optional());

const diplusStateSchema = z.union([z.string(), z.number()]);
const diplusFlagSchema = z.union([z.string(), z.number(), z.boolean()]);

export const telemetrySchema = z
  .object({
    soc: numericSchema,
    speed_kmh: numericSchema,
    power_kw: numericSchema,
    battery_temp_c: numericSchema,
    cabin_temp_c: numericSchema,
    outside_temp_c: numericSchema,
    battery_voltage_v: numericSchema,
    aux_voltage_v: numericSchema,
    cell_voltage_min_v: numericSchema,
    cell_voltage_max_v: numericSchema,
    cell_delta_v: numericSchema,
    diplus_min_cell_voltage_v: numericSchema,
    diplus_max_cell_voltage_v: numericSchema,
    diplus_cell_delta_v: numericSchema,
    odometer_km: numericSchema,
    soh_percent: numericSchema,
    is_charging: booleanSchema,
    charge_power_kw: numericSchema,
    charge_type: z.string().nullable().optional(),
    kwh_charged: numericSchema,
    range_est_km: numericSchema,
    current_trip_distance_km: numericSchema,
    current_trip_consumption_kwh_100km: numericSchema,
  })
  .strip();

export const diplusSchema = z
  .object({
    soc: numericSchema,
    speed_kmh: numericSchema,
    mileage_km: numericSchema,
    power_kw: numericSchema,
    charge_gun_state: diplusStateSchema.nullable().optional(),
    charging_status: diplusStateSchema.nullable().optional(),
    battery_capacity_kwh: numericSchema,
    total_elec_consumption_kwh: numericSchema,
    voltage_12v: numericSchema,
    max_cell_voltage_v: numericSchema,
    min_cell_voltage_v: numericSchema,
    cell_delta_v: numericSchema,
    avg_battery_temp_c: numericSchema,
    exterior_temp_c: numericSchema,
    gear: diplusStateSchema.nullable().optional(),
    power_state: diplusStateSchema.nullable().optional(),
    inside_temp_c: numericSchema,
    ac_status: diplusFlagSchema.nullable().optional(),
    ac_temp_c: numericSchema,
    fan_level: numericSchema,
    door_fl: diplusFlagSchema.nullable().optional(),
    door_fr: diplusFlagSchema.nullable().optional(),
    door_rl: diplusFlagSchema.nullable().optional(),
    door_rr: diplusFlagSchema.nullable().optional(),
    window_fl_percent: numericSchema,
    window_fr_percent: numericSchema,
    window_rl_percent: numericSchema,
    window_rr_percent: numericSchema,
    sunroof_percent: numericSchema,
    trunk: diplusFlagSchema.nullable().optional(),
    hood: diplusFlagSchema.nullable().optional(),
    tire_press_fl_kpa: numericSchema,
    tire_press_fr_kpa: numericSchema,
    tire_press_rl_kpa: numericSchema,
    tire_press_rr_kpa: numericSchema,
    drive_mode: diplusStateSchema.nullable().optional(),
    work_mode: diplusStateSchema.nullable().optional(),
    auto_park: diplusFlagSchema.nullable().optional(),
    rain: diplusFlagSchema.nullable().optional(),
    light_low: diplusFlagSchema.nullable().optional(),
    drl: diplusFlagSchema.nullable().optional(),
    sunshade_percent: numericSchema,
    sentry_state: diplusStateSchema.nullable().optional(),
    remote_lock_state: diplusStateSchema.nullable().optional(),
    stall_sentry_mode: z.string().nullable().optional(),
    sentry_provider: z.string().nullable().optional(),
    sentry_active: z.boolean().nullable().optional(),
  })
  .strip();

const optionalDiplusSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  diplusSchema.optional(),
);

export const locationSchema = z
  .object({
    lat: numericSchema,
    lon: numericSchema,
    accuracy_m: numericSchema,
    bearing_deg: numericSchema,
  })
  .strip();

export const payloadSchema = z
  .object({
    schema_version: z.literal(1),
    vehicle_id: z.string().min(1).max(160),
    device_time: z.string().min(1).max(80),
    source: z.literal("BYDMate"),
    mate_version: z.string().min(1).max(80).nullable().optional(),
    // Parked heartbeat that only needs to refresh live state. The ingest RPC
    // takes a fast path for these: live snapshot only, no history/hourly/trip
    // writes. Absent (older APK versions) means a normal full sample.
    live_only: booleanSchema,
    // Sample is already folded into an on-device hourly rollup (see `hourlyBlockSchema`
    // below), shipped once per flush in the batch envelope's "hourly" array. The ingest
    // RPC skips its own per-sample hourly upsert for these so the hour isn't double-counted.
    // Absent (older APK versions, or the daemon which has no Room access) means the server
    // keeps doing the per-sample upsert as it does today.
    client_hourly: booleanSchema,
    // Sample belongs to a trip the APK owns end to end (see `tripBlockSchema` below),
    // shipped cumulatively in the batch envelope's "trips" array. The ingest RPC skips its
    // own trip create/extend for these and only stubs the row + writes the track point.
    // Both absent (older APK versions, the daemon, or any sample outside a trip) means the
    // server derives the trip itself exactly as it does today.
    client_trip: booleanSchema,
    trip_id: z.string().uuid().nullable().optional(),
    telemetry: telemetrySchema,
    diplus: optionalDiplusSchema,
    location: locationSchema,
    autoservice: z
      .object({
        soc_percent: numericSchema,
        power_kw: numericSchema,
        gun_state: z.number().int().nullable().optional(),
        bms_state: z.number().int().nullable().optional(),
        charge_capacity_kwh: numericSchema,
        charge_battery_volt: numericSchema,
        battery_type: z.number().int().nullable().optional(),
        lifetime_mileage_km: numericSchema,
        lifetime_kwh: numericSchema,
      })
      .strip()
      .optional(),
  })
  .strip();

// One cumulative per-hour aggregate from HourlyRollupAccumulator.toJson(), shipped once per
// flush in the batch envelope's "hourly" array (never per-sample — a block spans the whole
// hour, a payload is built per sample). Averages/extrema are absent rather than 0 when no
// contributing sample had that field (e.g. a parked hour never sees battery_temp_c).
export const hourlyBlockSchema = z
  .object({
    hour_start: z.string().min(1).max(80),
    sample_count: z.number().int().min(0),
    soc_min: numericSchema,
    soc_max: numericSchema,
    soc_last: numericSchema,
    speed_max: numericSchema,
    power_avg: numericSchema,
    battery_temp_avg: numericSchema,
    cabin_temp_avg: numericSchema,
    outside_temp_avg: numericSchema,
    power_sample_count: z.number().int().min(0).optional(),
    battery_temp_sample_count: z.number().int().min(0).optional(),
    cabin_temp_sample_count: z.number().int().min(0).optional(),
    outside_temp_sample_count: z.number().int().min(0).optional(),
    regen_kwh_sum: numericSchema,
    traction_kwh_sum: numericSchema,
  })
  .strip();

// One cumulative per-trip aggregate from TripRollupAccumulator.toJson(), shipped once per
// flush in the batch envelope's "trips" array. Mirrors the real bydmate_trips columns.
// `ended_at` is present only once the trip is closed; the optional numerics are absent
// rather than 0 when there was no basis to compute them (e.g. distance_km before the
// odometer baseline has moved), so bydmate_apply_client_trip coalesces them against the
// stored row instead of nulling it.
export const tripBlockSchema = z
  .object({
    trip_id: z.string().uuid(),
    started_at: z.string().min(1).max(80),
    last_device_time: z.string().min(1).max(80),
    ended_at: z.string().min(1).max(80).nullable().optional(),
    sample_count: z.number().int().min(0),
    distance_km: numericSchema,
    soc_start: numericSchema,
    soc_end: numericSchema,
    max_speed_kmh: numericSchema,
    avg_speed_kmh: numericSchema,
    avg_consumption_kwh_100km: numericSchema,
    regen_energy_kwh: numericSchema,
    traction_energy_kwh: numericSchema,
  })
  .strip();

const batchPayloadSchema = z.union([
  z.array(payloadSchema).min(1).max(300),
  z
    .object({
      samples: z.array(payloadSchema).min(1).max(300),
      hourly: z.array(hourlyBlockSchema).max(24).optional(),
      // At most one open trip per vehicle, plus any just-closed trip still settling, so
      // this stays small — the cap only bounds a malformed or hostile body.
      trips: z.array(tripBlockSchema).max(24).optional(),
    })
    .strip(),
]);

export type TelemetryPayload = z.infer<typeof payloadSchema>;
export type LocationPayload = z.infer<typeof locationSchema>;
export type TelemetryPayloadData = z.infer<typeof telemetrySchema>;
export type DiplusPayloadData = z.infer<typeof diplusSchema>;
export type HourlyBlock = z.infer<typeof hourlyBlockSchema>;
export type TripBlock = z.infer<typeof tripBlockSchema>;

export function normalizePayloads(json: unknown) {
  const batchParsed = batchPayloadSchema.safeParse(json);
  if (batchParsed.success) {
    return {
      success: true as const,
      payloads: Array.isArray(batchParsed.data) ? batchParsed.data : batchParsed.data.samples,
      hourly: Array.isArray(batchParsed.data) ? [] : (batchParsed.data.hourly ?? []),
      trips: Array.isArray(batchParsed.data) ? [] : (batchParsed.data.trips ?? []),
    };
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return {
      success: false as const,
      issues: parsed.error.flatten().fieldErrors,
    };
  }

  return {
    success: true as const,
    payloads: [parsed.data],
    hourly: [] as HourlyBlock[],
    trips: [] as TripBlock[],
  };
}
