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
  .passthrough();

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
  })
  .passthrough();

export const locationSchema = z
  .object({
    lat: numericSchema,
    lon: numericSchema,
    accuracy_m: numericSchema,
    bearing_deg: numericSchema,
  })
  .passthrough();

export const payloadSchema = z
  .object({
    schema_version: z.literal(1),
    vehicle_id: z.string().min(1).max(160),
    device_time: z.string().min(1).max(80),
    source: z.literal("BYDMate"),
    telemetry: telemetrySchema,
    diplus: diplusSchema.optional(),
    location: locationSchema,
  })
  .passthrough();

const batchPayloadSchema = z.union([
  z.array(payloadSchema).min(1).max(300),
  z
    .object({
      samples: z.array(payloadSchema).min(1).max(300),
    })
    .passthrough(),
]);

export type TelemetryPayload = z.infer<typeof payloadSchema>;
export type LocationPayload = z.infer<typeof locationSchema>;
export type TelemetryPayloadData = z.infer<typeof telemetrySchema>;
export type DiplusPayloadData = z.infer<typeof diplusSchema>;

export function normalizePayloads(json: unknown) {
  const batchParsed = batchPayloadSchema.safeParse(json);
  if (batchParsed.success) {
    return {
      success: true as const,
      payloads: Array.isArray(batchParsed.data) ? batchParsed.data : batchParsed.data.samples,
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
  };
}
