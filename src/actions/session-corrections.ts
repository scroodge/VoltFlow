"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  isPlausibleMeasuredEfficiency,
  measuredEfficiencyForSession,
  summarizeTelemetryContext,
} from "@/lib/charging-efficiency-learning";
import type { TelemetrySampleRow } from "@/lib/charging-session-reconcile-logic";
import type { Car, ChargingSessionRow } from "@/types/database";

const TELEMETRY_PAGE_SIZE = 1000;
/** Matches the pad used by session reconcile telemetry loading (see
 *  charging-session-reconcile-logic.ts SESSION_WINDOW_PAD_MS) so a correction's
 *  temperature/power context covers the same window reconcile would have used. */
const SESSION_WINDOW_PAD_MS = 5 * 60_000;

const correctEnergySchema = z.object({
  sessionId: z.string().uuid(),
  billedKwh: z.coerce.number().positive().max(999),
  totalCost: z.coerce.number().min(0).max(99_999),
});

async function loadCorrectionTelemetry(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  session: Pick<ChargingSessionRow, "started_at" | "stopped_at">,
): Promise<TelemetrySampleRow[]> {
  const startMs = Date.parse(session.started_at!);
  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  const endMs = Number.isFinite(stoppedMs) && stoppedMs >= startMs ? stoppedMs : startMs;
  const from = new Date(startMs - SESSION_WINDOW_PAD_MS).toISOString();
  const to = new Date(endMs + SESSION_WINDOW_PAD_MS).toISOString();

  const rows: TelemetrySampleRow[] = [];
  for (let offset = 0; ; offset += TELEMETRY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("bydmate_telemetry_samples")
      .select("device_time, telemetry")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", from)
      .lte("device_time", to)
      .order("device_time", { ascending: true })
      .range(offset, offset + TELEMETRY_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as TelemetrySampleRow[];
    rows.push(...page);
    if (page.length < TELEMETRY_PAGE_SIZE) break;
  }
  return rows;
}

export type CorrectChargingSessionEnergyResult =
  | { ok: true; warning: "implausible_efficiency" | null; measuredEfficiencyPercent: number }
  | { ok: false; error: string };

/**
 * Smart Charge "Loose Mode": replaces a finished session's estimated energy/cost with the
 * provider's billed figures, protecting the edit from reconcile (energy_overridden) and
 * logging a measured-efficiency observation (see charging-efficiency-learning.ts) built
 * from the session's own SOC delta plus its telemetry window's battery/outside temp and
 * charge power. See docs/CHARGING_SESSIONS.md "Provider corrections & learned efficiency".
 */
export async function correctChargingSessionEnergy(
  input: z.infer<typeof correctEnergySchema>,
): Promise<CorrectChargingSessionEnergyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = correctEnergySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { data: sessionRow, error: sessionError } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .single();
  if (sessionError || !sessionRow) {
    return { ok: false, error: "Charging session not found" };
  }
  const session = sessionRow as ChargingSessionRow;
  if (session.status !== "completed" && session.status !== "stopped") {
    return { ok: false, error: "Only finished sessions can be corrected" };
  }
  if (!session.started_at) {
    return { ok: false, error: "Session is missing a start time" };
  }

  const { data: carRow, error: carError } = await supabase
    .from("cars")
    .select("*")
    .eq("id", session.car_id)
    .eq("user_id", user.id)
    .single();
  if (carError || !carRow) {
    return { ok: false, error: "Car not found" };
  }
  const car = carRow as Car;

  const { billedKwh, totalCost } = parsed.data;
  const socDeltaPercent = Number(session.current_percent) - Number(session.start_percent);
  const measuredEfficiencyPercent = measuredEfficiencyForSession({
    socDeltaPercent,
    batteryCapacityKwh: Number(session.battery_capacity_kwh),
    billedEnergyKwh: billedKwh,
  });
  if (measuredEfficiencyPercent == null) {
    return { ok: false, error: "Session has no measurable SOC gain to compare against" };
  }
  const warning = isPlausibleMeasuredEfficiency(measuredEfficiencyPercent)
    ? null
    : ("implausible_efficiency" as const);

  const pricePerKwh = totalCost / billedKwh;
  const correctedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("charging_sessions")
    .update({
      charged_energy_kwh: billedKwh,
      estimated_cost: totalCost,
      price_per_kwh: pricePerKwh,
      energy_overridden: true,
      energy_corrected_at: correctedAt,
    })
    .eq("id", session.id)
    .eq("user_id", user.id);
  if (updateError) return { ok: false, error: updateError.message };

  let telemetryContext = {
    avgBatteryTempC: null as number | null,
    avgOutsideTempC: null as number | null,
    avgChargePowerKw: null as number | null,
    sampleCount: 0,
  };
  const vehicleId = car.vehicle_alias?.trim();
  if (vehicleId) {
    const samples = await loadCorrectionTelemetry(supabase, user.id, vehicleId, session);
    telemetryContext = summarizeTelemetryContext(samples);
  }

  const { error: observationError } = await supabase
    .from("charging_efficiency_observations")
    .upsert(
      {
        user_id: user.id,
        car_id: session.car_id,
        session_id: session.id,
        tariff_type: session.tariff_type,
        measured_efficiency_percent: measuredEfficiencyPercent,
        soc_delta_percent: socDeltaPercent,
        battery_capacity_kwh: session.battery_capacity_kwh,
        billed_energy_kwh: billedKwh,
        billed_total_cost: totalCost,
        avg_battery_temp_c: telemetryContext.avgBatteryTempC,
        avg_outside_temp_c: telemetryContext.avgOutsideTempC,
        avg_charge_power_kw: telemetryContext.avgChargePowerKw,
        telemetry_sample_count: telemetryContext.sampleCount,
        computed_at: correctedAt,
      },
      { onConflict: "session_id" },
    );
  if (observationError) return { ok: false, error: observationError.message };

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath(`/history/${session.id}`);

  return { ok: true, warning, measuredEfficiencyPercent };
}
