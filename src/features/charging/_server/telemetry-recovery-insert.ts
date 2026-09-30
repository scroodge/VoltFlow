import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTariffPrice } from "../../../lib/charging-tariffs.ts";
import { costFromGridEnergy } from "../_domain/charging-math.ts";
import type { TelemetryRecoveryCandidate } from "../_domain/telemetry-recovery.ts";
import type { Car, ChargingSessionRow } from "@/types/database";

export type InsertRecoveredResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string; code?: "overlap" | "duplicate" };

/**
 * Inserts one telemetry-recovered session as `completed`. Shared by the owner-confirmed
 * History import and the automatic late-delivery recovery, so both apply the same guards:
 * unique `recovery_key`, no overlap with a closed session, and no overlap with a session that
 * is still open (its end is unknown, so a window reaching it cannot be claimed safely).
 *
 * NOT a server action: it takes an arbitrary client, so it must never be client-callable.
 */
export async function insertRecoveredSession(
  supabase: SupabaseClient,
  {
    userId,
    car,
    candidate,
  }: { userId: string; car: Car; candidate: TelemetryRecoveryCandidate },
): Promise<InsertRecoveredResult> {
  const [recoveredResult, closedResult, openResult, profileResult] =
    await Promise.all([
      supabase
        .from("charging_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("car_id", car.id)
        .eq("recovery_key", candidate.key)
        .maybeSingle(),
      supabase
        .from("charging_sessions")
        .select("id,started_at,stopped_at")
        .eq("user_id", userId)
        .eq("car_id", car.id)
        .lte("started_at", candidate.stoppedAt)
        .gte("stopped_at", candidate.startedAt),
      supabase
        .from("charging_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("car_id", car.id)
        .is("stopped_at", null)
        .lte("started_at", candidate.stoppedAt)
        .limit(1),
      supabase
        .from("profiles")
        .select(
          "default_price_per_kwh,home_price_per_kwh,commercial_ac_price_per_kwh,fast_dc_price_per_kwh",
        )
        .eq("id", userId)
        .maybeSingle(),
    ]);
  if (recoveredResult.error)
    return { ok: false, error: recoveredResult.error.message };
  if (closedResult.error)
    return { ok: false, error: closedResult.error.message };
  if (openResult.error) return { ok: false, error: openResult.error.message };
  if (profileResult.error)
    return { ok: false, error: profileResult.error.message };
  if (recoveredResult.data) {
    return {
      ok: false,
      error: "This recovery was already imported",
      code: "duplicate",
    };
  }
  const closed = (closedResult.data ?? []) as Pick<
    ChargingSessionRow,
    "id" | "started_at" | "stopped_at"
  >[];
  if (closed.length > 0 || (openResult.data ?? []).length > 0) {
    return {
      ok: false,
      error: "A charging session already covers this time range",
      code: "overlap",
    };
  }

  const pricePerKwh = resolveTariffPrice(
    candidate.tariffType,
    profileResult.data,
  );
  const { data: inserted, error } = await supabase
    .from("charging_sessions")
    .insert({
      user_id: userId,
      car_id: car.id,
      start_percent: candidate.startPercent,
      current_percent: candidate.endPercent,
      target_percent: 100,
      battery_capacity_kwh: car.battery_capacity_kwh,
      charger_power_kw: candidate.chargerPowerKw,
      efficiency_percent: candidate.efficiencyPercent,
      tariff_type: candidate.tariffType,
      provider_type: "custom",
      user_provider_id: null,
      tariff_manual: false,
      tariff_selected_at: null,
      price_per_kwh: pricePerKwh,
      charged_energy_kwh: candidate.chargedEnergyKwh,
      estimated_cost: costFromGridEnergy(
        candidate.chargedEnergyKwh,
        pricePerKwh,
      ),
      status: "completed",
      started_at: candidate.startedAt,
      stopped_at: candidate.stoppedAt,
      energy_overridden: false,
      manual_entry: false,
      session_origin: "telemetry_recovered",
      recovery_key: candidate.key,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    if (error?.code === "23505") {
      return {
        ok: false,
        error: "This recovery was already imported",
        code: "duplicate",
      };
    }
    return { ok: false, error: error?.message ?? "Could not import recovery" };
  }
  return { ok: true, sessionId: String(inserted.id) };
}
