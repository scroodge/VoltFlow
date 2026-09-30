"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { costFromGridEnergy } from "./_domain/charging-math";
import {
  findTelemetryRecoveryCandidates,
  type TelemetryRecoveryCandidate,
} from "./_domain/telemetry-recovery";
import { resolveTariffPrice } from "@/lib/charging-tariffs";
import type { Car, ChargingSessionRow, VoltflowMateTelemetry } from "@/types/database";

const RECOVERY_LOOKBACK_DAYS = 31;
const TELEMETRY_PAGE_SIZE = 1_000;
const MAX_RECOVERY_SAMPLES = 50_000;

const carSchema = z.object({ carId: z.string().uuid() });
const importSchema = carSchema.extend({ recoveryKey: z.string().min(1).max(160) });

type CandidateResult =
  | { ok: true; candidates: TelemetryRecoveryCandidate[] }
  | { ok: false; error: string };

async function loadOwnedCar(carId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, car: null };
  const { data: car, error } = await supabase
    .from("cars")
    .select("*")
    .eq("id", carId)
    .eq("user_id", user.id)
    .single();
  return { supabase, user, car: error || !car ? null : (car as Car) };
}

async function candidatesForOwnedCar(
  carId: string,
): Promise<{ error: string } | { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; car: Car; candidates: TelemetryRecoveryCandidate[] }> {
  const owned = await loadOwnedCar(carId);
  if (!owned.user) return { error: "Unauthorized" };
  if (!owned.car?.vehicle_alias?.trim()) return { error: "Vehicle is not linked" };

  const from = new Date(Date.now() - RECOVERY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const telemetry: { device_time: string; telemetry: VoltflowMateTelemetry }[] = [];
  for (let offset = 0; offset < MAX_RECOVERY_SAMPLES; offset += TELEMETRY_PAGE_SIZE) {
    const { data, error } = await owned.supabase
      .from("bydmate_telemetry_samples")
      .select("device_time,telemetry")
      .eq("user_id", owned.user.id)
      .eq("vehicle_id", owned.car.vehicle_alias.trim())
      .gte("device_time", from)
      .order("device_time", { ascending: true })
      .range(offset, offset + TELEMETRY_PAGE_SIZE - 1);
    if (error) return { error: error.message };
    telemetry.push(...((data ?? []) as { device_time: string; telemetry: VoltflowMateTelemetry }[]));
    if (!data || data.length < TELEMETRY_PAGE_SIZE) break;
  }
  if (telemetry.length >= MAX_RECOVERY_SAMPLES) {
    return { error: "Too much retained telemetry to recover safely" };
  }

  const detected = findTelemetryRecoveryCandidates(
    owned.car,
    telemetry,
  );
  const { data: sessions, error: sessionsError } = await owned.supabase
    .from("charging_sessions")
    .select("started_at,stopped_at,recovery_key")
    .eq("user_id", owned.user.id)
    .eq("car_id", owned.car.id)
    .gte("stopped_at", from);
  if (sessionsError) return { error: sessionsError.message };
  const existing = (sessions ?? []) as Pick<ChargingSessionRow, "started_at" | "stopped_at" | "recovery_key">[];
  const candidates = detected.filter((candidate) => !existing.some((session) =>
    session.recovery_key === candidate.key ||
    (session.started_at != null && session.stopped_at != null &&
      session.started_at <= candidate.stoppedAt && session.stopped_at >= candidate.startedAt),
  ));
  return { supabase: owned.supabase, userId: owned.user.id, car: owned.car, candidates };
}

export async function listTelemetryRecoveryCandidates(
  input: z.infer<typeof carSchema>,
): Promise<CandidateResult> {
  const parsed = carSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid vehicle" };
  const result = await candidatesForOwnedCar(parsed.data.carId);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, candidates: result.candidates };
}

export async function importTelemetryRecoveryCandidate(
  input: z.infer<typeof importSchema>,
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string; code?: "missing" | "overlap" | "duplicate" }> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid recovery candidate" };
  const result = await candidatesForOwnedCar(parsed.data.carId);
  if ("error" in result) return { ok: false, error: result.error };
  const candidate = result.candidates.find((item) => item.key === parsed.data.recoveryKey);
  if (!candidate) return { ok: false, error: "Recovery candidate is no longer available", code: "missing" };

  const [recoveredResult, neighboursResult, profileResult] = await Promise.all([
    result.supabase
      .from("charging_sessions")
      .select("id")
      .eq("user_id", result.userId)
      .eq("car_id", result.car.id)
      .eq("recovery_key", candidate.key)
      .maybeSingle(),
    result.supabase
      .from("charging_sessions")
      .select("id,started_at,stopped_at")
      .eq("user_id", result.userId)
      .eq("car_id", result.car.id)
      .lte("started_at", candidate.stoppedAt)
      .gte("stopped_at", candidate.startedAt),
    result.supabase
      .from("profiles")
      .select("default_price_per_kwh,home_price_per_kwh,commercial_ac_price_per_kwh,fast_dc_price_per_kwh")
      .eq("id", result.userId)
      .maybeSingle(),
  ]);
  if (recoveredResult.error) return { ok: false, error: recoveredResult.error.message };
  if (neighboursResult.error) return { ok: false, error: neighboursResult.error.message };
  if (profileResult.error) return { ok: false, error: profileResult.error.message };
  const recovered = recoveredResult.data;
  const neighbours = neighboursResult.data;
  const profile = profileResult.data;
  if (recovered) return { ok: false, error: "This recovery was already imported", code: "duplicate" };
  const existingRows = (neighbours ?? []) as Pick<ChargingSessionRow, "id" | "started_at" | "stopped_at">[];
  if (existingRows.some((row) => row.started_at && row.stopped_at && row.started_at <= candidate.stoppedAt && row.stopped_at >= candidate.startedAt)) {
    return { ok: false, error: "A charging session already covers this time range", code: "overlap" };
  }

  const pricePerKwh = resolveTariffPrice(candidate.tariffType, profile);
  const { data: inserted, error } = await result.supabase
    .from("charging_sessions")
    .insert({
      user_id: result.userId,
      car_id: result.car.id,
      start_percent: candidate.startPercent,
      current_percent: candidate.endPercent,
      target_percent: 100,
      battery_capacity_kwh: result.car.battery_capacity_kwh,
      charger_power_kw: candidate.chargerPowerKw,
      efficiency_percent: candidate.efficiencyPercent,
      tariff_type: candidate.tariffType,
      provider_type: "custom",
      user_provider_id: null,
      tariff_manual: false,
      tariff_selected_at: null,
      price_per_kwh: pricePerKwh,
      charged_energy_kwh: candidate.chargedEnergyKwh,
      estimated_cost: costFromGridEnergy(candidate.chargedEnergyKwh, pricePerKwh),
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
    if (error?.code === "23505") return { ok: false, error: "This recovery was already imported", code: "duplicate" };
    return { ok: false, error: error?.message ?? "Could not import recovery" };
  }

  revalidatePath("/dashboard");
  revalidatePath("/history");
  return { ok: true, sessionId: String(inserted.id) };
}
