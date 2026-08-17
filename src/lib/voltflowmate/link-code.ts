import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";

import {
  voltflowMateApiKeyFingerprint,
  hashVoltflowMateApiKey,
  type VoltflowMateDeviceKind,
} from "@/lib/voltflowmate/api-auth";
import { siteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";

export const BYDMATE_LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const BYDMATE_LINK_CODE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const BYDMATE_LINK_CODE_MAX_FAILED_ATTEMPTS = 10;

// Handed back to Mate on redeem, which persists it as its sync URL — so this is
// what moves an already-paired car to a new domain without a re-link.
const DEFAULT_TELEMETRY_ENDPOINT = siteUrl("/api/bydmate/telemetry");

function linkCodePepper(): string {
  const pepper = process.env.BYDMATE_LINK_CODE_PEPPER?.trim();
  if (pepper) return pepper;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallback) return fallback;
  throw new Error("Missing BYDMATE_LINK_CODE_PEPPER or SUPABASE_SERVICE_ROLE_KEY");
}

export function hashLinkCode(code: string): string {
  const normalized = code.replace(/\D/g, "");
  return createHash("sha256")
    .update(`${normalized}:${linkCodePepper()}`)
    .digest("hex");
}

export function hashClientIp(ip: string): string {
  const trimmed = ip.trim();
  return createHash("sha256")
    .update(`ip:${trimmed}:${linkCodePepper()}`)
    .digest("hex");
}

export function normalizeLinkCodeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 6) return null;
  return digits;
}

export function generateSixDigitLinkCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function deriveVoltflowMateCloudApiKey(linkCodeId: string): string {
  return createHmac("sha256", linkCodePepper())
    .update(`bydmate-pairing-key:${linkCodeId}`)
    .digest("hex");
}

export function voltflowMateTelemetryEndpointUrl(): string {
  const explicit = process.env.BYDMATE_TELEMETRY_ENDPOINT_URL?.trim();
  if (explicit) return explicit;

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (apiBase) return `${apiBase}/api/bydmate/telemetry`;

  // VERCEL_PROJECT_PRODUCTION_URL is always the stable production domain.
  // VERCEL_URL changes per deployment (preview URLs are Vercel-auth-protected → 401).
  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost}/api/bydmate/telemetry`;

  return DEFAULT_TELEMETRY_ENDPOINT;
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export async function createVoltflowMateLinkCode(userId: string): Promise<{
  code: string;
  expiresAt: string;
}> {
  const supabase = createServiceClient();
  const now = Date.now();
  const expiresAt = new Date(now + BYDMATE_LINK_CODE_TTL_MS).toISOString();

  const { error: deleteError } = await supabase
    .from("bydmate_link_codes")
    .delete()
    .eq("user_id", userId)
    .is("redeemed_at", null);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const code = generateSixDigitLinkCode();
  const id = randomUUID();
  const apiKey = deriveVoltflowMateCloudApiKey(id);
  const { error: insertError } = await supabase.from("bydmate_link_codes").insert({
    id,
    user_id: userId,
    code_hash: hashLinkCode(code),
    api_key_hash: hashVoltflowMateApiKey(apiKey),
    api_key_fingerprint: voltflowMateApiKeyFingerprint(apiKey),
    expires_at: expiresAt,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return { code, expiresAt };
}

async function pruneOldRedeemAttempts() {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from("bydmate_link_redeem_attempts")
    .delete()
    .lt("attempted_at", cutoff);
}

export async function isRedeemRateLimited(ipHash: string): Promise<boolean> {
  await pruneOldRedeemAttempts();
  const supabase = createServiceClient();
  const since = new Date(Date.now() - BYDMATE_LINK_CODE_RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("bydmate_link_redeem_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("attempted_at", since);

  if (error) {
    throw new Error(error.message);
  }

  return (count ?? 0) >= BYDMATE_LINK_CODE_MAX_FAILED_ATTEMPTS;
}

export async function recordFailedRedeemAttempt(ipHash: string) {
  const supabase = createServiceClient();
  await supabase.from("bydmate_link_redeem_attempts").insert({ ip_hash: ipHash });
}

export async function redeemVoltflowMateLinkCode(
  rawCode: string,
  ipHash: string,
  // Older Mate builds send no client field, and Mate is the only thing that ever paired
  // before the Dashboard existed — so an unstated kind is 'mate'.
  deviceKind: VoltflowMateDeviceKind = "mate",
  // Recorded here so a freshly paired device shows a version immediately, rather than
  // reading "unknown" until its first session call. Older clients send nothing.
  appVersion?: { version: string | null; versionCode: number | null },
): Promise<
  | { ok: true; apiKey: string; endpointUrl: string }
  | { ok: false; error: string; rateLimited?: boolean }
> {
  const code = normalizeLinkCodeInput(rawCode);
  if (!code) {
    await recordFailedRedeemAttempt(ipHash);
    return { ok: false, error: "Invalid code" };
  }

  if (await isRedeemRateLimited(ipHash)) {
    return { ok: false, error: "Too many attempts", rateLimited: true };
  }

  const supabase = createServiceClient();
  const codeHash = hashLinkCode(code);
  const nowIso = new Date().toISOString();

  const { data: row, error } = await supabase
    .from("bydmate_link_codes")
    .select("id, user_id, expires_at, redeemed_at, api_key_hash")
    .eq("code_hash", codeHash)
    .is("redeemed_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!row) {
    await recordFailedRedeemAttempt(ipHash);
    return { ok: false, error: "Invalid or expired code" };
  }

  const apiKey = deriveVoltflowMateCloudApiKey(row.id as string);
  if (row.api_key_hash !== hashVoltflowMateApiKey(apiKey)) {
    await recordFailedRedeemAttempt(ipHash);
    return { ok: false, error: "Invalid or expired code" };
  }

  // Promote the pending credential before consuming the code. If the database
  // update fails, the owner can retry the same short-lived code instead of being
  // left with a redeemed code and no usable vehicle credential.
  //
  // This writes only the redeeming client's own device row. Overwriting a single
  // per-profile key here is what used to make pairing the Dashboard revoke Mate, and
  // pairing Mate revoke the Dashboard.
  const reportedVersion = appVersion?.version ?? null;
  const reportedVersionCode = appVersion?.versionCode ?? null;
  const { error: deviceError } = await supabase.from("bydmate_devices").upsert(
    {
      user_id: row.user_id as string,
      kind: deviceKind,
      api_key_hash: hashVoltflowMateApiKey(apiKey),
      api_key_fingerprint: voltflowMateApiKeyFingerprint(apiKey),
      // Re-pairing replaces the row, so these are always written: leaving a stale
      // version behind would be worse than showing none.
      app_version: reportedVersion,
      version_code: reportedVersionCode,
      app_version_seen_at:
        reportedVersion || reportedVersionCode != null ? nowIso : null,
    },
    { onConflict: "user_id,kind" },
  );

  if (deviceError) {
    throw new Error(deviceError.message);
  }

  // Mate's key stays mirrored onto the profile: it is still the column that marks an
  // account as having a car attached, and the legacy auth fallback reads it.
  if (deviceKind === "mate") {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        bydmate_cloud_api_key: null,
        bydmate_cloud_api_key_hash: hashVoltflowMateApiKey(apiKey),
        bydmate_cloud_api_key_fingerprint: voltflowMateApiKeyFingerprint(apiKey),
      })
      .eq("id", row.user_id as string);

    if (profileError) {
      throw new Error(profileError.message);
    }
  }

  const { data: redeemed, error: redeemError } = await supabase
    .from("bydmate_link_codes")
    .update({ redeemed_at: nowIso })
    .eq("id", row.id)
    .is("redeemed_at", null)
    .select("id")
    .maybeSingle();

  if (redeemError) {
    throw new Error(redeemError.message);
  }
  if (!redeemed) {
    await recordFailedRedeemAttempt(ipHash);
    return { ok: false, error: "Invalid or expired code" };
  }

  return {
    ok: true,
    apiKey,
    endpointUrl: voltflowMateTelemetryEndpointUrl(),
  };
}
