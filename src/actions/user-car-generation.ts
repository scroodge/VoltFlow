"use server";

import { isCarGeneration, type CarGeneration } from "@/lib/car-generations";
import { createClient } from "@/lib/supabase/server";

export async function getUserCarGeneration(): Promise<{
  generation: CarGeneration | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { generation: null };

  const { data } = await supabase
    .from("cars")
    .select("model_generation")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!data?.model_generation) return { generation: null };
  return {
    generation: isCarGeneration(data.model_generation)
      ? data.model_generation
      : null,
  };
}

export async function setUserCarGeneration(
  generation: CarGeneration,
): Promise<{ ok: boolean }> {
  if (!isCarGeneration(generation)) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("cars")
    .update({ model_generation: generation })
    .eq("user_id", user.id);

  return { ok: !error };
}
