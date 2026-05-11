"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { deriveChargingState } from "@/lib/charging-math";
import type { SessionStatus } from "@/types/database";

const startSchema = z.object({
  carId: z.string().uuid(),
  startPercent: z.coerce.number().min(0).max(99),
  targetPercent: z.coerce.number().min(1).max(100),
  pricePerKwh: z.coerce.number().min(0).max(999).optional(),
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

  const pricePerKwh = parsed.data.pricePerKwh ?? 0;

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
      price_per_kwh: pricePerKwh,
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
  const derived = deriveChargingState(
    {
      startPercent: session.start_percent,
      targetPercent: session.target_percent,
      batteryCapacityKwh: session.battery_capacity_kwh,
      chargerPowerKw: session.charger_power_kw,
      efficiencyPercent: session.efficiency_percent,
      pricePerKwh: session.price_per_kwh,
    },
    Date.parse(session.started_at),
    now.getTime(),
  );

  const { error: updateError } = await supabase
    .from("charging_sessions")
    .update({
      current_percent: derived.currentPercent,
      charged_energy_kwh: derived.chargedEnergyKwh,
      estimated_cost: derived.estimatedCost,
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
