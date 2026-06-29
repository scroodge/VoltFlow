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
