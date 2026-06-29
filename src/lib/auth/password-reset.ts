"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function sendPasswordResetEmail(email: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback/recovery?next=${encodeURIComponent("/reset-password")}`
      : undefined;

  // Use implicit flow for password reset; self-hosted Supabase may not support
  // PKCE for recovery. The recovery callback reads tokens from the URL hash.
  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: { flowType: "implicit" },
  });

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
