import { createHash, randomBytes } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveBydmateApiKeyProfile } from "@/lib/bydmate/api-auth";
import { isPremiumFromUntil } from "@/lib/premium-entitlement";

const CLUSTER_CMD_KEY = "cluster_projection_cmd";
const CLUSTER_CLOSE_CMD_KEY = "cluster_projection_close_cmd";

export function encryptDashboardCommand(
  command: string,
  apiKey: string,
  nonce: string,
): string {
  const key = createHash("sha256").update(apiKey + nonce).digest();
  const input = Buffer.from(command, "utf8");
  const output = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i]! ^ key[i % key.length]!;
  }
  return output.toString("base64");
}

export function createDashboardNonce(): string {
  return randomBytes(16).toString("hex");
}

export async function isDashboardEntitled(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const primaryProfile = await supabase
    .from("profiles")
    .select("is_premium,premium_until")
    .eq("id", userId)
    .maybeSingle();
  const profileResult =
    primaryProfile.error &&
    primaryProfile.error.code === "42703" &&
    primaryProfile.error.message.includes("premium_until")
      ? await supabase.from("profiles").select("is_premium").eq("id", userId).maybeSingle()
      : primaryProfile;
  const { data: profileRaw, error: profileError } = profileResult;

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profile = (profileRaw ?? null) as
    | { is_premium?: boolean | null; premium_until?: string | null }
    | null;
  const hasPremiumUntil = isPremiumFromUntil(profile?.premium_until);
  if (profile?.is_premium === true || hasPremiumUntil) {
    return true;
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError) {
    throw new Error(adminError.message);
  }

  return adminRow?.user_id != null;
}

export async function loadClusterProjectionCommand(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mate_dashboard_secrets")
    .select("value")
    .eq("key", CLUSTER_CMD_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const value = typeof data?.value === "string" ? data.value.trim() : "";
  return value || null;
}

export async function loadClusterProjectionCloseCommand(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mate_dashboard_secrets")
    .select("value")
    .eq("key", CLUSTER_CLOSE_CMD_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const value = typeof data?.value === "string" ? data.value.trim() : "";
  return value || null;
}

export async function resolveDashboardSession(
  supabase: SupabaseClient,
  apiKey: string,
  options?: { allowDebugBuild?: boolean },
): Promise<
  | {
      ok: true;
      entitled: true;
      command: string;
      nonce: string;
      closeCommand: string;
      closeNonce: string;
    }
  | { ok: false; error: string; status: number }
> {
  if (!options?.allowDebugBuild && process.env.ALLOW_DEBUG_DASHBOARD !== "true") {
    // Production default: no special debug bypass required for entitled users.
  }

  const profile = await resolveBydmateApiKeyProfile(supabase, apiKey);
  if (!profile) {
    return { ok: false, error: "invalid_api_key", status: 401 };
  }

  const entitled = await isDashboardEntitled(supabase, profile.id);
  if (!entitled) {
    return { ok: false, error: "not_entitled", status: 403 };
  }

  const command = await loadClusterProjectionCommand(supabase);
  if (!command) {
    return { ok: false, error: "command_unavailable", status: 503 };
  }

  const closeCommand =
    (await loadClusterProjectionCloseCommand(supabase)) ?? "迪加强关仪表投屏";

  const nonce = createDashboardNonce();
  const encrypted = encryptDashboardCommand(command, apiKey.trim(), nonce);
  const closeNonce = createDashboardNonce();
  const encryptedClose = encryptDashboardCommand(closeCommand, apiKey.trim(), closeNonce);
  return {
    ok: true,
    entitled: true,
    command: encrypted,
    nonce,
    closeCommand: encryptedClose,
    closeNonce,
  };
}
