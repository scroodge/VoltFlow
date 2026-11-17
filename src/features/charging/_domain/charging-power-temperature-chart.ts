import type { VoltflowMateTelemetry } from "@/types/database";

export type ChargingPowerTemperatureSample = {
  device_time: string;
  telemetry: Pick<VoltflowMateTelemetry, "charge_power_kw" | "battery_temp_c">;
};

export type ChargingPowerTemperaturePoint = {
  time: number;
  powerKw: number | null;
  batteryTempC: number | null;
};

function finiteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Keeps only measured session samples for the power/temperature timeline. Zero is a
 * meaningful measured charge power (for example, a taper/stall), while negative power
 * cannot be a charging-power measurement and is discarded.
 */
export function chargingPowerTemperaturePoints(
  samples: readonly ChargingPowerTemperatureSample[],
): ChargingPowerTemperaturePoint[] {
  return samples
    .flatMap((sample) => {
      const time = Date.parse(sample.device_time);
      const rawPowerKw = finiteNumber(sample.telemetry.charge_power_kw);
      const powerKw = rawPowerKw != null && rawPowerKw >= 0 ? rawPowerKw : null;
      const batteryTempC = finiteNumber(sample.telemetry.battery_temp_c);

      return Number.isFinite(time) && (powerKw != null || batteryTempC != null)
        ? [{ time, powerKw, batteryTempC }]
        : [];
    })
    .sort((left, right) => left.time - right.time);
}
