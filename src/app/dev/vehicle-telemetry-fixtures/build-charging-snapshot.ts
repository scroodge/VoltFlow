import type { BydmateLiveSnapshotRow, BydmateTelemetry } from "@/types/database";

export type ChargingSampleRef = {
  device_time: string;
  received_at: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateLiveSnapshotRow["diplus"];
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

function chargePowerKw(telemetry: BydmateTelemetry) {
  const kw = telemetry.charge_power_kw ?? telemetry.power_kw;
  if (typeof kw === "number" && Number.isFinite(kw) && Math.abs(kw) > 0.1) {
    return Math.abs(kw);
  }
  return 7.2;
}

/** Fresh live snapshot for dev “charging” mode — prefers a real charging sample when present. */
export function buildChargingSnapshot(
  base: BydmateLiveSnapshotRow,
  sample: ChargingSampleRef | null,
): BydmateLiveSnapshotRow {
  const now = new Date().toISOString();

  if (sample) {
    const telemetry = sample.telemetry ?? {};
    const kw = chargePowerKw(telemetry);
    return {
      ...base,
      device_time: sample.device_time,
      received_at: now,
      updated_at: now,
      telemetry: {
        ...base.telemetry,
        ...telemetry,
        is_charging: true,
        charge_power_kw: kw,
        charge_type: telemetry.charge_type ?? base.telemetry.charge_type ?? "AC",
        power_kw: typeof telemetry.power_kw === "number" ? telemetry.power_kw : -kw,
      },
      diplus: sample.diplus ?? base.diplus,
      diplus_min_cell_voltage_v: sample.diplus_min_cell_voltage_v ?? base.diplus_min_cell_voltage_v,
      diplus_max_cell_voltage_v: sample.diplus_max_cell_voltage_v ?? base.diplus_max_cell_voltage_v,
      diplus_cell_delta_v: sample.diplus_cell_delta_v ?? base.diplus_cell_delta_v,
    };
  }

  const soc = base.telemetry.soc ?? 58;
  return {
    ...base,
    device_time: now,
    received_at: now,
    updated_at: now,
    telemetry: {
      ...base.telemetry,
      soc,
      is_charging: true,
      charge_power_kw: 7.4,
      charge_type: base.telemetry.charge_type ?? "AC",
      power_kw: -7.4,
      battery_temp_c: base.telemetry.battery_temp_c ?? 28,
      outside_temp_c: base.telemetry.outside_temp_c ?? 12,
      cabin_temp_c: base.telemetry.cabin_temp_c ?? 20,
      kwh_charged: base.telemetry.kwh_charged ?? 4.2,
    },
  };
}
