import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lateDeliveryWindows,
  type LateDeliverySample,
} from "../_domain/late-delivery-window.ts";
import type { RecoveryTelemetrySample } from "../_domain/telemetry-recovery.ts";
import type { Car, VoltflowMateTelemetry } from "@/types/database";
import { recoverLateCharges } from "./late-charge-recovery.ts";
import { insertRecoveredSession } from "./telemetry-recovery-insert.ts";

const PAGE_SIZE = 1_000;
// 12 h lookback at the ~11 s charging cadence is ~4k rows; this only guards a runaway range.
const MAX_SAMPLES = 20_000;

// Only the fields the detector reads, so a scan does not pull whole telemetry blobs.
const SAMPLE_COLUMNS = [
  "device_time",
  "soc:telemetry->soc",
  "charge_power_kw:telemetry->charge_power_kw",
  "speed_kmh:telemetry->speed_kmh",
  "is_charging:telemetry->is_charging",
  "charge_type:telemetry->charge_type",
].join(",");

type SampleRow = {
  device_time: string;
  soc: number | null;
  charge_power_kw: number | null;
  speed_kmh: number | null;
  is_charging: boolean | null;
  charge_type: string | null;
};

/**
 * After a telemetry batch has been persisted: if any of it reached the server late, recover
 * the closed charges it completes. Live auto-start rejects old measurements on purpose, so
 * without this a charge recorded while the car was offline would never reach History.
 * No-op (and no query) when every sample was delivered promptly.
 */
export async function recoverLateChargesForBatch({
  supabase,
  userId,
  samples,
  receivedAt,
}: {
  supabase: SupabaseClient;
  userId: string;
  samples: readonly LateDeliverySample[];
  receivedAt: string;
}) {
  const windows = lateDeliveryWindows(samples, Date.parse(receivedAt));
  return recoverLateCharges(windows, {
    async loadCar(vehicleId) {
      const { data, error } = await supabase
        .from("cars")
        .select("*")
        .eq("user_id", userId)
        .eq("vehicle_alias", vehicleId)
        .order("id")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Car | null) ?? null;
    },
    async loadSamples(vehicleId, fromIso, toIso) {
      const rows: RecoveryTelemetrySample[] = [];
      for (let offset = 0; offset < MAX_SAMPLES; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("bydmate_telemetry_samples")
          .select(SAMPLE_COLUMNS)
          .eq("user_id", userId)
          .eq("vehicle_id", vehicleId)
          .gte("device_time", fromIso)
          .lte("device_time", toIso)
          .order("device_time", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as unknown as SampleRow[];
        for (const row of page) {
          rows.push({
            device_time: row.device_time,
            telemetry: {
              soc: row.soc,
              charge_power_kw: row.charge_power_kw,
              speed_kmh: row.speed_kmh,
              is_charging: row.is_charging,
              charge_type: row.charge_type,
            } as VoltflowMateTelemetry,
          });
        }
        if (page.length < PAGE_SIZE) return rows;
      }
      return null;
    },
    insert: (car, candidate) =>
      insertRecoveredSession(supabase, { userId, car, candidate }),
  });
}
