"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { carGenerations, isCarGeneration } from "@/lib/car-generations";
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
    .default(90),
});

function parseCarFormData(formData: FormData) {
  const generationRaw = formData.get("model_generation");
  return carSchema.safeParse({
    name: formData.get("name"),
    model_generation: isCarGeneration(generationRaw) ? generationRaw : "gen1_2024",
    battery_capacity_kwh: normalizeFormDecimal(formData.get("battery_capacity_kwh")),
    default_charger_power_kw: normalizeFormDecimal(formData.get("default_charger_power_kw")),
    default_efficiency_percent: formData.get("default_efficiency_percent"),
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
