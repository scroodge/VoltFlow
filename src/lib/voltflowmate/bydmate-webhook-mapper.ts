import { z } from "zod";

// AndyShaman/BYDMate's own "Webhook — telemetry" setting POSTs one flat JSON object per
// tick — no envelope, no batching, no vehicle id, no X-API-Key/X-Vehicle-Id headers.
// Identity is resolved by the caller from the URL token (see webhook-token-auth.ts);
// this module only maps the third-party shape into this project's normalized
// telemetry/location fields (see src/lib/voltflowmate/ingest-payload.ts).
//
// Field-by-field source: WebhookTelemetryClient.kt / IternioTelemetryClient.kt in
// github.com/AndyShaman/BYDMate (read, not copied — see BACKLOG.md for the full diff
// against this project's own fields).

const numeric = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable().optional());

export const bydMateWebhookSchema = z
  .object({
    utc: numeric,
    soc: numeric,
    speed: numeric,
    power: numeric,
    voltage: numeric,
    current: numeric,
    hvac_setpoint: numeric,
    batt_temp: numeric,
    ext_temp: numeric,
    capacity: numeric,
    odometer: numeric,
    cabin_temp: numeric,
    tire_pressure_fl: numeric,
    tire_pressure_fr: numeric,
    tire_pressure_rl: numeric,
    tire_pressure_rr: numeric,
    is_charging: numeric,
    is_parked: numeric,
    is_dcfc: numeric,
    kwh_charged: numeric,
    soh: numeric,
    car_model: z.string().optional(),
    lat: numeric,
    lon: numeric,
    heading: numeric,
  })
  .passthrough();

export type BydMateWebhookPayload = z.infer<typeof bydMateWebhookSchema>;

export type MappedBydMateTelemetry = {
  deviceTime: string;
  telemetry: Record<string, unknown>;
  location: Record<string, unknown>;
};

function inRange(value: number | null | undefined, min: number, max: number) {
  return typeof value === "number" && value >= min && value <= max;
}

/**
 * Maps one AndyShaman/BYDMate webhook sample into this project's normalized
 * telemetry/location shape, or returns null when the sample can't be used at all.
 *
 * `power` is intentionally NOT forwarded as `charge_power_kw` — it's a signed net
 * battery-power reading with its own fallback chain (can silently prioritize motor/
 * ENG_POW power over battery power outside charging). `voltage` and `current` are the
 * same `hvVoltage`/`hvCurrent` inputs the app's own precise "battery power" (W) readout
 * is built from (confirmed against the app's source), so charge power is recomputed
 * from those directly: `abs(voltage * current) / 1000`, gated on `is_charging`.
 */
export function mapBydMateWebhookPayload(
  raw: BydMateWebhookPayload,
): MappedBydMateTelemetry | null {
  // Matches the sender's own gate: IternioTelemetryClient.buildTelemetry() never sends
  // a sample without soc, and utc is required to place the sample on the timeline.
  if (!inRange(raw.soc, 0, 100)) return null;
  if (typeof raw.utc !== "number" || raw.utc <= 0) return null;

  const deviceTime = new Date(raw.utc * 1000).toISOString();
  const isCharging = raw.is_charging === 1;
  const voltage = inRange(raw.voltage, 100, 900) ? raw.voltage! : null;
  const current =
    typeof raw.current === "number" &&
    Number.isFinite(raw.current) &&
    Math.abs(raw.current) <= 2000
      ? raw.current
      : null;

  const chargePowerKw =
    isCharging && voltage != null && current != null
      ? Math.round(Math.abs((voltage * current) / 1000) * 1000) / 1000
      : 0;

  const telemetry: Record<string, unknown> = {
    soc: raw.soc,
    speed_kmh: inRange(raw.speed, 0, 260) ? raw.speed : null,
    is_charging: isCharging,
    charge_power_kw: chargePowerKw,
    charge_type: raw.is_dcfc === 1 ? "dc" : isCharging ? "ac" : null,
    battery_voltage_v: voltage,
    battery_temp_c: typeof raw.batt_temp === "number" ? raw.batt_temp : null,
    cabin_temp_c: typeof raw.cabin_temp === "number" ? raw.cabin_temp : null,
    outside_temp_c: typeof raw.ext_temp === "number" ? raw.ext_temp : null,
    odometer_km:
      typeof raw.odometer === "number" && raw.odometer >= 0
        ? raw.odometer
        : null,
    soh_percent: inRange(raw.soh, 0, 100) ? raw.soh : null,
    kwh_charged:
      typeof raw.kwh_charged === "number" && raw.kwh_charged >= 0
        ? raw.kwh_charged
        : null,
  };

  const hasCoordinates =
    typeof raw.lat === "number" &&
    typeof raw.lon === "number" &&
    inRange(raw.lat, -90, 90) &&
    inRange(raw.lon, -180, 180) &&
    !(raw.lat === 0 && raw.lon === 0);

  const location: Record<string, unknown> = hasCoordinates
    ? {
        lat: raw.lat,
        lon: raw.lon,
        bearing_deg: typeof raw.heading === "number" ? raw.heading : null,
      }
    : {};

  return { deviceTime, telemetry, location };
}
