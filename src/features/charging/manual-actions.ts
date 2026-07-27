"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  deriveManualSessionFields,
  manualSessionOverlaps,
  type ManualSessionError,
} from "./_domain/manual-session";
import type { Car, ChargingSessionRow, SessionStatus } from "@/types/database";

/**
 * How far from the entered start time we will look for a telemetry SOC to anchor the
 * session's percent range. The pipeline usually *does* have samples for a missed charge —
 * it just never met the 4-sample auto-start streak — so an anchor is often available.
 */
const SOC_ANCHOR_WINDOW_MS = 10 * 60_000;

/** Widen the overlap scan past the entered window so neighbouring sessions are seen. */
const OVERLAP_SCAN_PAD_MS = 24 * 3_600_000;

const createSchema = z.object({
  carId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  stoppedAt: z.string().datetime({ offset: true }),
  billedKwh: z.coerce.number().positive().max(999),
  totalCost: z.coerce.number().min(0).max(99_999),
});

export type CreateManualChargingSessionResult =
  | { ok: true; sessionId: string; socAnchored: boolean }
  | { ok: false; error: string; code?: ManualSessionError | "overlap" | "future" };

/**
 * Find the SOC telemetry recorded closest to `startedAtMs`, so a hand-entered session can
 * sit at the right place on the battery instead of an arbitrary 0 → delta range.
 * Returns null when the car has no `vehicle_alias` or nothing was sampled in the window.
 */
async function findAnchorSoc(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  startedAtMs: number,
): Promise<number | null> {
  const from = new Date(startedAtMs - SOC_ANCHOR_WINDOW_MS).toISOString();
  const to = new Date(startedAtMs + SOC_ANCHOR_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .gte("device_time", from)
    .lte("device_time", to)
    .order("device_time", { ascending: true });

  if (error || !data?.length) return null;

  let best: { distance: number; soc: number } | null = null;
  for (const row of data as { device_time: string; telemetry: Record<string, unknown> }[]) {
    const soc = Number(row.telemetry?.soc);
    if (!Number.isFinite(soc) || soc < 0 || soc > 100) continue;
    const sampleMs = Date.parse(row.device_time);
    if (!Number.isFinite(sampleMs)) continue;
    const distance = Math.abs(sampleMs - startedAtMs);
    if (!best || distance < best.distance) best = { distance, soc };
  }
  return best?.soc ?? null;
}

/**
 * Create a charging session the ingest pipeline never recorded, from provider-receipt
 * figures (billed kWh, total paid, start/end time).
 *
 * The row is written with `energy_overridden = true` so `sessionNeedsReconcile` skips it —
 * without that, the reconcile that runs on every sessions-list load would recompute the
 * energy from telemetry that, by definition, was too sparse to detect the charge at all.
 * It is also flagged `manual_entry` so the UI can badge it, deletion can be scoped to it,
 * and efficiency learning can exclude it.
 *
 * See docs/CHARGING_SESSIONS.md → "Manual entry for missed sessions".
 */
export async function createManualChargingSession(
  input: z.infer<typeof createSchema>,
): Promise<CreateManualChargingSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const startedAtMs = Date.parse(parsed.data.startedAt);
  const stoppedAtMs = Date.parse(parsed.data.stoppedAt);
  const nowMs = Date.now();
  if (startedAtMs > nowMs || stoppedAtMs > nowMs) {
    return { ok: false, error: "Session cannot be in the future", code: "future" };
  }

  const { data: carRow, error: carError } = await supabase
    .from("cars")
    .select("*")
    .eq("id", parsed.data.carId)
    .eq("user_id", user.id)
    .single();
  if (carError || !carRow) return { ok: false, error: "Car not found" };
  const car = carRow as Car;

  // Overlap guard: entering a charge that was in fact recorded would double-count it in the
  // day summary and every monthly total.
  const { data: neighbours, error: neighbourError } = await supabase
    .from("charging_sessions")
    .select("started_at, stopped_at")
    .eq("user_id", user.id)
    .eq("car_id", car.id)
    .gte("started_at", new Date(startedAtMs - OVERLAP_SCAN_PAD_MS).toISOString())
    .lte("started_at", new Date(stoppedAtMs + OVERLAP_SCAN_PAD_MS).toISOString());
  if (neighbourError) return { ok: false, error: neighbourError.message };

  const candidate = { startedAtMs, stoppedAtMs };
  const clashes = (neighbours ?? []) as Pick<ChargingSessionRow, "started_at" | "stopped_at">[];
  if (clashes.some((row) => manualSessionOverlaps(row, candidate))) {
    return {
      ok: false,
      error: "A charging session already covers this time range",
      code: "overlap",
    };
  }

  const vehicleId = car.vehicle_alias?.trim();
  const anchorSoc = vehicleId
    ? await findAnchorSoc(supabase, user.id, vehicleId, startedAtMs)
    : null;

  const derivation = deriveManualSessionFields({
    billedKwh: parsed.data.billedKwh,
    totalCost: parsed.data.totalCost,
    startedAtMs,
    stoppedAtMs,
    car,
    anchorSoc,
  });
  if (!derivation.ok) {
    return { ok: false, error: "Invalid session details", code: derivation.reason };
  }
  const d = derivation.derived;

  const { data: session, error: insertError } = await supabase
    .from("charging_sessions")
    .insert({
      user_id: user.id,
      car_id: car.id,
      start_percent: d.startPercent,
      current_percent: d.currentPercent,
      target_percent: d.targetPercent,
      battery_capacity_kwh: car.battery_capacity_kwh,
      charger_power_kw: d.chargerPowerKw,
      efficiency_percent: d.efficiencyPercent,
      tariff_type: d.tariffType,
      provider_type: d.providerType,
      user_provider_id: null,
      // The price came from the receipt, so never let GPS tariff sync rewrite it.
      tariff_manual: true,
      tariff_selected_at: null,
      price_per_kwh: d.pricePerKwh,
      charged_energy_kwh: d.chargedEnergyKwh,
      estimated_cost: d.estimatedCost,
      status: "completed" as SessionStatus,
      started_at: parsed.data.startedAt,
      stopped_at: parsed.data.stoppedAt,
      energy_overridden: true,
      manual_entry: true,
    })
    .select("id")
    .single();

  if (insertError || !session) {
    return { ok: false, error: insertError?.message ?? "Insert failed" };
  }

  // Deliberately no `charging_efficiency_observations` row: this session's SOC delta was
  // derived *from* the billed kWh using the configured efficiency, so recording it as a
  // measurement would be circular and would corrupt learned efficiency.

  revalidatePath("/dashboard");
  revalidatePath("/history");

  return { ok: true, sessionId: session.id as string, socAnchored: d.socAnchored };
}

const deleteSchema = z.object({ sessionId: z.string().uuid() });

/**
 * Delete a hand-entered session. Scoped to `manual_entry` rows so an auto-detected session
 * can never be removed through this path — telemetry-derived history stays immutable.
 */
export async function deleteManualChargingSession(
  input: z.infer<typeof deleteSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { data: deleted, error } = await supabase
    .from("charging_sessions")
    .delete()
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .eq("manual_entry", true)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!deleted?.length) {
    return { ok: false, error: "Only manually added sessions can be deleted" };
  }

  revalidatePath("/dashboard");
  revalidatePath("/history");

  return { ok: true };
}
