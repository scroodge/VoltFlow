import { createHash, randomBytes, randomInt } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";

export const BYDMATE_LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const BYDMATE_LINK_CODE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const BYDMATE_LINK_CODE_MAX_FAILED_ATTEMPTS = 10;

const DEFAULT_TELEMETRY_ENDPOINT =
  "https://volt-flow-beige.vercel.app/api/bydmate/telemetry";

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

export function generateBydmateCloudApiKey(): string {
  const bytes = randomBytes(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bydmateTelemetryEndpointUrl(): string {
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

export async function ensureBydmateCloudApiKey(userId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("bydmate_cloud_api_key")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const existing =
    typeof profile?.bydmate_cloud_api_key === "string"
      ? profile.bydmate_cloud_api_key.trim()
      : "";
  if (existing) return existing;

  const key = generateBydmateCloudApiKey();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ bydmate_cloud_api_key: key })
    .eq("id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return key;
}

export async function createBydmateLinkCode(userId: string): Promise<{
  code: string;
  expiresAt: string;
}> {
  await ensureBydmateCloudApiKey(userId);

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
  const { error: insertError } = await supabase.from("bydmate_link_codes").insert({
    user_id: userId,
    code_hash: hashLinkCode(code),
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

export async function redeemBydmateLinkCode(
  rawCode: string,
  ipHash: string,
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
    .select("id, user_id, expires_at, redeemed_at")
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

  const { error: redeemError } = await supabase
    .from("bydmate_link_codes")
    .update({ redeemed_at: nowIso })
    .eq("id", row.id)
    .is("redeemed_at", null);

  if (redeemError) {
    throw new Error(redeemError.message);
  }

  const apiKey = await ensureBydmateCloudApiKey(row.user_id as string);

  return {
    ok: true,
    apiKey,
    endpointUrl: bydmateTelemetryEndpointUrl(),
  };
}
