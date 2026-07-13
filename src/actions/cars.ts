"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { carGenerations, isCarGeneration } from "@/lib/car-generations";
import {
  DEFAULT_AC_EFFICIENCY_PERCENT,
  DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
} from "@/lib/charging-efficiency";
import { createClient } from "@/lib/supabase/server";
import { normalizeFormDecimal } from "@/lib/number-input";

const carSchema = z.object({
  name: z.string().min(1).max(120),
  model_generation: z.enum(carGenerations),
  battery_capacity_kwh: z.coerce.number().positive().max(500),
  default_charger_power_kw: z.coerce.number().positive().max(350).default(4.4),
  default_efficiency_percent: z.coerce
    .number()
    .min(50)
    .max(100)
    .default(DEFAULT_AC_EFFICIENCY_PERCENT),
  fast_dc_efficiency_percent: z.coerce
    .number()
    .min(50)
    .max(100)
    .default(DEFAULT_FAST_DC_EFFICIENCY_PERCENT),
  home_charger_lat: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().min(-90).max(90).nullable().optional(),
  ),
  home_charger_lon: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().min(-180).max(180).nullable().optional(),
  ),
  home_charger_radius_m: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().min(10).max(5000).nullable().optional(),
  ),
});

function parseCarFormData(formData: FormData) {
  const generationRaw = formData.get("model_generation");
  return carSchema.safeParse({
    name: formData.get("name"),
    model_generation: isCarGeneration(generationRaw) ? generationRaw : "gen1_2024",
    battery_capacity_kwh: normalizeFormDecimal(formData.get("battery_capacity_kwh")),
    default_charger_power_kw: normalizeFormDecimal(formData.get("default_charger_power_kw")),
    default_efficiency_percent: formData.get("default_efficiency_percent"),
    fast_dc_efficiency_percent: formData.get("fast_dc_efficiency_percent"),
    home_charger_lat: formData.get("home_charger_lat"),
    home_charger_lon: formData.get("home_charger_lon"),
    home_charger_radius_m: formData.get("home_charger_radius_m"),
  });
}

export async function createCar(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = parseCarFormData(formData);

  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.flatten().fieldErrors };
  }

  const { error, data } = await supabase
    .from("cars")
    .insert({
      user_id: user.id,
      ...parsed.data,
    })
    .select("id")
    .single();

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/cars/new");
  revalidatePath("/settings");

  return { ok: true as const, carId: data.id };
}

export async function updateCar(carId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = parseCarFormData(formData);

  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.flatten().fieldErrors };
  }

  const { error } = await supabase
    .from("cars")
    .update(parsed.data)
    .eq("id", carId)
    .eq("user_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath(`/cars/${carId}/edit`);

  return { ok: true as const };
}

export async function deleteCar(carId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const { error } = await supabase
    .from("cars")
    .delete()
    .eq("id", carId)
    .eq("user_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return { ok: true as const };
}
