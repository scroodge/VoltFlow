import { createHash, randomBytes } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  hashVoltflowMateApiKey,
  resolveVoltflowMateApiKeyProfile,
} from "@/lib/voltflowmate/api-auth";
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

  const profile = await resolveVoltflowMateApiKeyProfile(supabase, apiKey);
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

export type DashboardAppVersion = {
  version: string | null;
  versionCode: number | null;
};

/**
 * Normalizes a client-reported build, from a header or a pairing body.
 *
 * Both values are client-supplied and therefore untrusted: this is a display value,
 * never an authorization input. Anything that is not a plain dotted number or a
 * positive integer is dropped rather than stored.
 */
export function normalizeReportedAppVersion(
  version: unknown,
  versionCode: unknown,
): DashboardAppVersion {
  const rawVersion = typeof version === "string" ? version.trim() : "";
  const normalizedVersion =
    rawVersion.length > 0 && rawVersion.length <= 32 && /^\d+(?:\.\d+)*$/.test(rawVersion)
      ? rawVersion
      : null;

  const rawCode =
    typeof versionCode === "number"
      ? versionCode
      : Number.parseInt(typeof versionCode === "string" ? versionCode.trim() : "", 10);
  const normalizedCode = Number.isSafeInteger(rawCode) && rawCode > 0 ? rawCode : null;

  return { version: normalizedVersion, versionCode: normalizedCode };
}

/** Reads `X-Dashboard-Version` / `X-Dashboard-Version-Code` off a session request. */
export function parseDashboardVersionHeaders(
  versionHeader: string | null,
  versionCodeHeader: string | null,
): DashboardAppVersion {
  return normalizeReportedAppVersion(versionHeader, versionCodeHeader);
}

/**
 * Persists the build the head unit is running, for display in settings.
 *
 * Write-on-change by design. The `last_seen_at` note on 20260816120000 explains why the
 * credential row must not take a write per request; this stays cheap because it compares
 * first and only writes when the reported build actually differs. Call it from the
 * Dashboard's session route only — that call is cached for 6 h on the head unit — and
 * never from `resolveVoltflowMateApiKeyProfile`, which Mate's ~6 s command poll shares.
 *
 * Never throws: a failure to record a version must not cost an entitled user their
 * cluster. It logs instead, which is the signal that this stopped working.
 */
export async function recordDashboardAppVersion(
  supabase: SupabaseClient,
  apiKey: string,
  reported: DashboardAppVersion,
): Promise<void> {
  if (!reported.version && reported.versionCode == null) return;

  try {
    const keyHash = hashVoltflowMateApiKey(apiKey.trim());
    const { data: device, error: readError } = await supabase
      .from("bydmate_devices")
      .select("id, app_version, version_code")
      .eq("api_key_hash", keyHash)
      .eq("kind", "dashboard")
      .maybeSingle();

    if (readError || !device?.id) return;

    const unchanged =
      (device.app_version ?? null) === reported.version &&
      (device.version_code ?? null) === reported.versionCode;
    if (unchanged) return;

    const { error: writeError } = await supabase
      .from("bydmate_devices")
      .update({
        app_version: reported.version,
        version_code: reported.versionCode,
        app_version_seen_at: new Date().toISOString(),
      })
      .eq("id", device.id as string);

    if (writeError) {
      console.error("Dashboard version record failed:", writeError.message);
    }
  } catch (error) {
    console.error("Dashboard version record failed:", error);
  }
}
