"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { CATEGORY_COLORS } from "@/types/service";

export async function listUserServiceCategories() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const { data, error } = await supabase
    .from("user_service_categories")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, categories: data };
}

const insertSchema = z.object({
  name: z.string().min(1).max(50).trim(),
});

export async function insertUserServiceCategory(input: z.infer<typeof insertSchema>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const parsed = insertSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid name" };

  const name = parsed.data.name;

  const { data: existing } = await supabase
    .from("user_service_categories")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", name)
    .maybeSingle();

  if (existing) return { ok: false as const, error: "Category already exists" };

  const allCategories = await supabase
    .from("user_service_categories")
    .select("id")
    .eq("user_id", user.id);

  const idx = (allCategories.data?.length ?? 0) % CATEGORY_COLORS.length;
  const color = CATEGORY_COLORS[idx];

  const { data, error } = await supabase
    .from("user_service_categories")
    .insert({ user_id: user.id, name, color })
    .select("*")
    .single();

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/service");
  return { ok: true as const, category: data };
}

export async function deleteUserServiceCategory(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  const { error } = await supabase
    .from("user_service_categories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/service");
  return { ok: true as const };
}
