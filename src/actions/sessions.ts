"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { costFromGridEnergy, deriveChargingState } from "@/lib/charging-math";
import { mapChargingTariffLocation, mapUserProvider } from "@/lib/db-map";
import { resolveStopProgressForSession } from "@/lib/charging-session-finalize";
import {
  sessionTariffMatches,
  shouldAutoApplyTariffResolution,
} from "@/lib/charging-session-tariff-sync";
import {
  matchNearestTariffLocation,
  PROVIDER_LABELS,
  resolveSessionTariff,
  userProvidersFromRows,
} from "@/lib/charging-tariffs";
import {
  decideTariffLocationAutosave,
  uniqueTariffLocationName,
} from "@/lib/charging-tariff-location-autosave";
import type { ChargingProviderType, ChargingTariffType, SessionStatus } from "@/types/database";

const startSchema = z.object({
  carId: z.string().uuid(),
  startPercent: z.coerce.number().min(0).max(99),
  targetPercent: z.coerce.number().min(1).max(100),
  pricePerKwh: z.coerce.number().min(0).max(999).optional(),
  tariffType: z.enum(["home", "commercial_ac", "fast_dc"]).optional(),
  providerType: z
    .enum(["home", "malanka", "evika", "forevo", "zaryadka", "batterfly", "user_provider", "custom"])
    .optional(),
  userProviderId: z.string().uuid().optional(),
  chargerPowerKw: z.coerce.number().positive().max(350).optional(),
});

export async function startChargingSession(input: z.infer<typeof startSchema>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid input" };
  }

  const { carId, startPercent, targetPercent } = parsed.data;
  if (startPercent >= targetPercent) {
    return { ok: false as const, error: "Target must be above current charge" };
  }

  const { data: car, error: carError } = await supabase
    .from("cars")
    .select("*")
    .eq("id", carId)
    .eq("user_id", user.id)
    .single();

  if (carError || !car) return { ok: false as const, error: "Car not found" };

  const chargerPowerKw =
    parsed.data.chargerPowerKw ?? Number(car.default_charger_power_kw);

  await supabase
    .from("charging_sessions")
    .update({
      status: "stopped",
      stopped_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("status", "charging");

  const [{ data: liveRows }, { data: profile }, { data: rawPresets }, { data: rawUserProviders }] =
    await Promise.all([
      supabase
        .from("bydmate_live_snapshots")
        .select("location")
        .eq("user_id", user.id)
        .order("received_at", { ascending: false })
        .limit(1),
      supabase
        .from("profiles")
        .select(
          "default_price_per_kwh,home_price_per_kwh,commercial_ac_price_per_kwh,fast_dc_price_per_kwh",
        )
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("charging_tariff_locations")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("user_providers")
        .select("*")
        .eq("user_id", user.id),
    ]);

  const liveLocation = liveRows?.[0]?.location as { lat?: number; lon?: number } | null | undefined;
  const locationPresets = (rawPresets ?? []).map((row) =>
    mapChargingTariffLocation(row as Record<string, unknown>),
  );
  const userProviderMap = userProvidersFromRows(
    (rawUserProviders ?? []).map((row) => mapUserProvider(row as Record<string, unknown>)),
  );
  const manualTariffType = (parsed.data.tariffType ?? null) as ChargingTariffType | null;
  const tariff = resolveSessionTariff({
    manualPricePerKwh: parsed.data.pricePerKwh,
    manualTariffType,
    manualProviderType: parsed.data.providerType ?? null,
    userProviderId: parsed.data.userProviderId ?? null,
    chargerPowerKw,
    location: liveLocation,
    locationPresets,
    profile,
    userProviderMap,
  });

  const { data: session, error: insertError } = await supabase
    .from("charging_sessions")
    .insert({
      user_id: user.id,
      car_id: carId,
      start_percent: startPercent,
      current_percent: startPercent,
      target_percent: targetPercent,
      battery_capacity_kwh: car.battery_capacity_kwh,
      charger_power_kw: chargerPowerKw,
      efficiency_percent: car.default_efficiency_percent,
      tariff_type: tariff.tariffType,
      provider_type: tariff.providerType,
      user_provider_id: tariff.userProviderId,
      tariff_manual: tariff.source === "manual",
      tariff_selected_at:
        tariff.source === "manual" && tariff.providerType !== "custom"
          ? new Date().toISOString()
          : null,
      price_per_kwh: tariff.pricePerKwh,
      charged_energy_kwh: 0,
      estimated_cost: 0,
      status: "charging" as SessionStatus,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !session) {
    return { ok: false as const, error: insertError?.message ?? "Insert failed" };
  }

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath(`/charging/${session.id}`);

  return { ok: true as const, sessionId: session.id };
}

export async function stopChargingSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const { data: session, error } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "charging")
    .single();

  if (error || !session) {
    return { ok: false as const, error: "Charging session not found" };
  }

  const now = new Date();
  const progress = await resolveStopProgressForSession(
    supabase,
    user.id,
    session,
    now.getTime(),
  );

  const { error: updateError } = await supabase
    .from("charging_sessions")
    .update({
      current_percent: progress.currentPercent,
      charged_energy_kwh: progress.chargedEnergyKwh,
      estimated_cost: progress.estimatedCost,
      status: "stopped" as SessionStatus,
      stopped_at: now.toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (updateError) {
    return { ok: false as const, error: updateError.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath(`/charging/${sessionId}`);

  return { ok: true as const };
}

const updateTariffSchema = z.object({
  sessionId: z.string().uuid(),
  tariffType: z.enum(["home", "commercial_ac", "fast_dc"]),
  providerType: z.enum(["home", "malanka", "evika", "forevo", "zaryadka", "batterfly", "user_provider", "custom"]),
  userProviderId: z.string().uuid().optional(),
  pricePerKwh: z.coerce.number().min(0).max(999),
});

export async function updateChargingSessionTariff(
  input: z.infer<typeof updateTariffSchema>,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = updateTariffSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const { data: session, error } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .single();
  if (error || !session) {
    return { ok: false as const, error: "Charging session not found" };
  }

  const pricePerKwh = parsed.data.pricePerKwh;
  let estimatedCost = Number(session.estimated_cost ?? 0);
  let chargedEnergyKwh = Number(session.charged_energy_kwh ?? 0);
  let currentPercent = Number(session.current_percent ?? session.start_percent);

  if (session.status === "charging" && session.started_at) {
    const derived = deriveChargingState(
      {
        startPercent: session.start_percent,
        targetPercent: session.target_percent,
        batteryCapacityKwh: session.battery_capacity_kwh,
        chargerPowerKw: session.charger_power_kw,
        efficiencyPercent: session.efficiency_percent,
        pricePerKwh,
      },
      Date.parse(session.started_at),
      Date.now(),
    );
    estimatedCost = derived.estimatedCost;
    chargedEnergyKwh = derived.chargedEnergyKwh;
    currentPercent = derived.currentPercent;
  } else {
    estimatedCost = costFromGridEnergy(chargedEnergyKwh, pricePerKwh);
  }

  const { error: updateError } = await supabase
    .from("charging_sessions")
    .update({
      tariff_type: parsed.data.tariffType,
      provider_type: parsed.data.providerType,
      user_provider_id: parsed.data.providerType === "user_provider" ? (parsed.data.userProviderId ?? null) : null,
      tariff_manual: true,
      // Re-picking a provider resets the delay clock for the background
      // GPS-location auto-save; picking "custom" or "user_provider" cancels it.
      tariff_selected_at:
        parsed.data.providerType !== "custom" && parsed.data.providerType !== "user_provider"
          ? new Date().toISOString() : null,
      price_per_kwh: pricePerKwh,
      estimated_cost: estimatedCost,
      charged_energy_kwh: chargedEnergyKwh,
      current_percent: currentPercent,
    })
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id);
  if (updateError) return { ok: false as const, error: updateError.message };

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath(`/charging/${parsed.data.sessionId}`);
  revalidatePath(`/history/${parsed.data.sessionId}`);

  return { ok: true as const };
}

const syncTariffSchema = z.object({
  sessionId: z.string().uuid(),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export async function syncChargingSessionTariffFromGps(
  input: z.infer<typeof syncTariffSchema>,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = syncTariffSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const { data: session, error } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .single();
  if (error || !session) {
    return { ok: false as const, error: "Charging session not found" };
  }
  if (session.status !== "charging" || session.tariff_manual === true) {
    return { ok: true as const, applied: false as const };
  }

  const [{ data: profile }, { data: rawPresets }, { data: rawUserProviders }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "default_price_per_kwh,home_price_per_kwh,commercial_ac_price_per_kwh,fast_dc_price_per_kwh",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("charging_tariff_locations").select("*").eq("user_id", user.id),
    supabase.from("user_providers").select("*").eq("user_id", user.id),
  ]);

  const locationPresets = (rawPresets ?? []).map((row) =>
    mapChargingTariffLocation(row as Record<string, unknown>),
  );
  const userProviderMap = userProvidersFromRows(
    (rawUserProviders ?? []).map((row) => mapUserProvider(row as Record<string, unknown>)),
  );
  const tariff = resolveSessionTariff({
    chargerPowerKw: Number(session.charger_power_kw),
    location: { lat: parsed.data.lat, lon: parsed.data.lon },
    locationPresets,
    profile,
    userProviderMap,
  });

  if (!shouldAutoApplyTariffResolution(tariff)) {
    return { ok: true as const, applied: false as const };
  }
  if (sessionTariffMatches(session, tariff)) {
    return {
      ok: true as const,
      applied: false as const,
      locationName: locationPresets.find((preset) => preset.id === tariff.locationPresetId)?.name ?? null,
      alreadyApplied: true as const,
    };
  }

  const pricePerKwh = tariff.pricePerKwh;
  let estimatedCost = Number(session.estimated_cost ?? 0);
  let chargedEnergyKwh = Number(session.charged_energy_kwh ?? 0);
  let currentPercent = Number(session.current_percent ?? session.start_percent);

  if (session.started_at) {
    const derived = deriveChargingState(
      {
        startPercent: session.start_percent,
        targetPercent: session.target_percent,
        batteryCapacityKwh: session.battery_capacity_kwh,
        chargerPowerKw: session.charger_power_kw,
        efficiencyPercent: session.efficiency_percent,
        pricePerKwh,
      },
      Date.parse(session.started_at),
      Date.now(),
    );
    estimatedCost = derived.estimatedCost;
    chargedEnergyKwh = derived.chargedEnergyKwh;
    currentPercent = derived.currentPercent;
  }

  const { error: updateError } = await supabase
    .from("charging_sessions")
    .update({
      tariff_type: tariff.tariffType,
      provider_type: tariff.providerType,
      user_provider_id: tariff.userProviderId,
      tariff_manual: false,
      price_per_kwh: pricePerKwh,
      estimated_cost: estimatedCost,
      charged_energy_kwh: chargedEnergyKwh,
      current_percent: currentPercent,
    })
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id);
  if (updateError) return { ok: false as const, error: updateError.message };

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath(`/charging/${parsed.data.sessionId}`);

  const locationName =
    locationPresets.find((preset) => preset.id === tariff.locationPresetId)?.name ?? null;

  return { ok: true as const, applied: true as const, locationName };
}

const persistTariffLocationSchema = z.object({
  sessionId: z.string().uuid(),
  browserLat: z.coerce.number().min(-90).max(90).optional(),
  browserLon: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * Called by ChargingSessionBackgroundSync a few minutes after the user manually picks
 * a provider on the active charge screen. Saves the car's current GPS spot as a
 * `charging_tariff_locations` row (or corrects an existing one) so future charges at
 * the same spot auto-apply the provider — see [[docs/CHARGING_SESSIONS.md]] and
 * BACKLOG.md "Editable provider tariffs + auto-save GPS point after manual provider pick".
 */
export async function persistManualTariffLocationFromSession(
  input: z.infer<typeof persistTariffLocationSchema>,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = persistTariffLocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const { data: session, error } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .single();
  if (error || !session) {
    return { ok: false as const, error: "Charging session not found" };
  }

  const [{ data: liveRows }, { data: rawPresets }] = await Promise.all([
    supabase
      .from("bydmate_live_snapshots")
      .select("location")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(1),
    supabase.from("charging_tariff_locations").select("*").eq("user_id", user.id),
  ]);

  const liveLocation = liveRows?.[0]?.location as
    | { lat?: number; lon?: number }
    | null
    | undefined;
  const location =
    typeof liveLocation?.lat === "number" && typeof liveLocation?.lon === "number"
      ? { lat: liveLocation.lat, lon: liveLocation.lon }
      : parsed.data.browserLat != null && parsed.data.browserLon != null
        ? { lat: parsed.data.browserLat, lon: parsed.data.browserLon }
        : null;

  const locationPresets = (rawPresets ?? []).map((row) =>
    mapChargingTariffLocation(row as Record<string, unknown>),
  );
  const matched = location ? matchNearestTariffLocation(location, locationPresets) : null;

  const decision = decideTariffLocationAutosave({
    sessionStatus: session.status,
    tariffManual: session.tariff_manual === true,
    providerType: session.provider_type,
    tariffSelectedAt: session.tariff_selected_at,
    nowMs: Date.now(),
    location,
    matched,
  });

  if (decision.action === "skip") {
    return { ok: true as const, applied: false as const, reason: decision.reason };
  }

  if (decision.action === "update") {
    const { error: updateError } = await supabase
      .from("charging_tariff_locations")
      .update({
        provider_type: session.provider_type,
        tariff_type: session.tariff_type,
      })
      .eq("id", decision.matchedLocationId)
      .eq("user_id", user.id);
    if (updateError) return { ok: false as const, error: updateError.message };
    return {
      ok: true as const,
      applied: true as const,
      action: "update" as const,
      locationId: decision.matchedLocationId,
    };
  }

  if (!location) return { ok: false as const, error: "Missing location" };

  const providerType = session.provider_type as Exclude<ChargingProviderType, "custom">;
  const name = uniqueTariffLocationName(
    PROVIDER_LABELS[providerType],
    locationPresets.map((preset) => preset.name),
  );

  const { data: inserted, error: insertError } = await supabase
    .from("charging_tariff_locations")
    .insert({
      user_id: user.id,
      name,
      lat: location.lat,
      lng: location.lon,
      radius_m: 150,
      tariff_type: session.tariff_type,
      provider_type: session.provider_type,
      price_per_kwh_override: null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { ok: false as const, error: insertError?.message ?? "Insert failed" };
  }

  return {
    ok: true as const,
    applied: true as const,
    action: "insert" as const,
    locationId: inserted.id as string,
    name,
  };
}
