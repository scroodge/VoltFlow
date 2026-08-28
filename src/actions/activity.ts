"use server";

import { createClient } from "@/lib/supabase/server";
import { stampUserActivity } from "@/lib/user-activity";

export async function touchUserActivity() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  return stampUserActivity(supabase, user.id);
}
