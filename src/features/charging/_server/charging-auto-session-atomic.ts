import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { efficiencyPercentForTariff } from "@/lib/charging-efficiency";
import { mapChargingTariffLocation, mapUserProvider } from "@/lib/db-map";
import { resolveSessionTariff, userProvidersFromRows } from "@/lib/charging-tariffs";
import { captureSessionEndDelta } from "@/lib/voltflowmate/charge-end-delta";
import type { TelemetryPayload } from "@/lib/voltflowmate/ingest-payload";
import { sanitizeChargerPowerKw } from "../_domain/telemetry-charging";
import { drainChargingQueue, type ChargingProcessingSnapshot } from "./charging-auto-session-processor";

export type { AutoChargingSessionState, AutoChargingSessionAction } from "./charging-auto-session-step";
export { nextAutoChargingSessionStep } from "./charging-auto-session-step";

async function resolveTariffForTelemetry(
  supabase: SupabaseClient, userId: string, chargerPowerKw: number, location: TelemetryPayload["location"],
) {
  const results = await Promise.all([
    supabase.from("profiles").select("default_price_per_kwh,home_price_per_kwh,commercial_ac_price_per_kwh,fast_dc_price_per_kwh").eq("id", userId).maybeSingle(),
    supabase.from("charging_tariff_locations").select("*").eq("user_id", userId),
    supabase.from("user_providers").select("*").eq("user_id", userId),
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  const [profile, presets, providers] = results;
  return resolveSessionTariff({
    chargerPowerKw, location, profile: profile.data,
    locationPresets: (presets.data ?? []).map((row) => mapChargingTariffLocation(row as Record<string, unknown>)),
    userProviderMap: userProvidersFromRows((providers.data ?? []).map((row) => mapUserProvider(row as Record<string, unknown>))),
  });
}

export async function processVoltflowMateAutoChargingSessions({
  supabase, userId, samples,
}: { supabase: SupabaseClient; userId: string; samples: TelemetryPayload[] }) {
  const ordinary = samples.filter((sample) => sample.live_only !== true);
  const result = { started: 0, stopped: 0, sessionIds: [] as string[] };
  for (const vehicleId of new Set(ordinary.map((sample) => sample.vehicle_id))) {
    // Retry charging work independently of telemetry insertion/deduplication.
    const { error: enqueueError } = await supabase.rpc("bydmate_enqueue_charging_samples", {
      p_user_id: userId, p_vehicle_id: vehicleId,
      p_samples: ordinary.filter((sample) => sample.vehicle_id === vehicleId),
    });
    if (enqueueError) throw new Error(enqueueError.message);
    const processed = await drainChargingQueue({
      async read() {
        const { data, error } = await supabase.rpc("bydmate_read_charging_batch", {
          p_user_id: userId, p_vehicle_id: vehicleId,
        });
        if (error) throw new Error(error.message);
        if (!data) throw new Error("Missing charging processing snapshot");
        return data as ChargingProcessingSnapshot;
      },
      async commit(snapshot, plan) {
        const { data, error } = await supabase.rpc("bydmate_commit_charging_batch", {
          p_user_id: userId, p_vehicle_id: vehicleId,
          p_expected_version: snapshot.state?.state_version ?? 0,
          p_expected_sessions: snapshot.sessions, p_expected_car: snapshot.car,
          p_state: plan.state, p_operations: plan.operations, p_consumed_times: plan.consumedTimes,
        });
        if (error) throw new Error(error.message);
        if (data?.committed === true) return true;
        if (data?.conflict === true) return false;
        throw new Error("Invalid charging commit response");
      },
    }, async (car, sample, action) => {
      const chargeType = typeof sample.telemetry.charge_type === "string" ? sample.telemetry.charge_type : null;
      const power = sanitizeChargerPowerKw(action.chargerPowerKw, chargeType, car.default_charger_power_kw);
      const tariff = await resolveTariffForTelemetry(supabase, userId, power, sample.location);
      return {
        id: randomUUID(), user_id: userId, car_id: car.id,
        start_percent: action.startPercent, current_percent: action.startPercent, target_percent: 100,
        battery_capacity_kwh: car.battery_capacity_kwh, charger_power_kw: power,
        efficiency_percent: efficiencyPercentForTariff(car, tariff.tariffType),
        tariff_type: tariff.tariffType, provider_type: tariff.providerType,
        user_provider_id: tariff.userProviderId, tariff_manual: false,
        price_per_kwh: tariff.pricePerKwh, charged_energy_kwh: 0, estimated_cost: 0,
        status: "charging", started_at: action.startedAt,
      };
    });
    result.started += processed.started;
    result.stopped += processed.stopped;
    result.sessionIds.push(...processed.sessionIds);
    // Diagnostic capture remains outside the short state/session transaction.
    for (const id of processed.closedIds) await captureSessionEndDelta(supabase, id);
  }
  return result;
}
