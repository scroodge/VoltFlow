import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveChargingState, deriveSessionProgressFromSoc } from "@/lib/charging-math";
import { chargingParamsFromSession } from "@/lib/charging-session-sync";
import { isFreshLiveSnapshot, snapshotSoc } from "@/lib/charging-live";
import { finiteTelemetryNumber } from "@/lib/bydmate/telemetry-charging";
import type { ChargingSessionRow } from "@/types/database";

export type StopSessionProgressSource = "live" | "telemetry" | "math";

export type StopSessionProgress = {
  currentPercent: number;
  chargedEnergyKwh: number;
  estimatedCost: number;
  source: StopSessionProgressSource;
};

function socFromTelemetryJson(telemetry: { soc?: unknown } | null | undefined) {
  const soc = finiteTelemetryNumber(telemetry?.soc);
  return soc != null && soc >= 0 && soc <= 100 ? soc : null;
}

export async function resolveStopProgressForSession(
  supabase: SupabaseClient,
  userId: string,
  session: ChargingSessionRow,
  nowMs: number = Date.now(),
): Promise<StopSessionProgress> {
  const params = chargingParamsFromSession(session);
  const startedAtMs = session.started_at ? Date.parse(session.started_at) : nowMs;
  const mathState = deriveChargingState(params, startedAtMs, nowMs);

  const { data: car } = await supabase
    .from("cars")
    .select("vehicle_alias")
    .eq("id", session.car_id)
    .eq("user_id", userId)
    .maybeSingle();

  const vehicleId = (car?.vehicle_alias as string | null | undefined)?.trim();
  if (!vehicleId) {
    return { ...mathState, source: "math" };
  }

  const { data: live } = await supabase
    .from("bydmate_live_snapshots")
    .select("received_at, telemetry, vehicle_id")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();

  if (live && isFreshLiveSnapshot(live, nowMs)) {
    const liveSoc = snapshotSoc(live);
    if (liveSoc != null) {
      return { ...deriveSessionProgressFromSoc(params, liveSoc), source: "live" };
    }
  }

  if (session.started_at) {
    const { data: sample } = await supabase
      .from("bydmate_telemetry_samples")
      .select("telemetry")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", session.started_at)
      .order("device_time", { ascending: false })
      .limit(1)
      .maybeSingle();

    const telemetrySoc = socFromTelemetryJson(
      sample?.telemetry as { soc?: unknown } | null | undefined,
    );
    if (telemetrySoc != null) {
      return { ...deriveSessionProgressFromSoc(params, telemetrySoc), source: "telemetry" };
    }
  }

  return {
    currentPercent: mathState.currentPercent,
    chargedEnergyKwh: mathState.chargedEnergyKwh,
    estimatedCost: mathState.estimatedCost,
    source: "math",
  };
}
