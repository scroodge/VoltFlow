import crypto from "node:crypto";

/**
 * Telegram Mini App `initData` validation.
 *
 * The Mini App passes `window.Telegram.WebApp.initData` (a URL-encoded query
 * string) to our server. We MUST verify its HMAC signature with the bot token
 * before trusting any identity — `initDataUnsafe` (used client-side for theme)
 * is, by name, untrusted.
 *
 * Algorithm (per https://core.telegram.org/bots/webapps#validating-data):
 *   secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 *   hash       = HMAC_SHA256(key=secret_key,  msg=data_check_string)
 * where data_check_string is every `key=value` pair except `hash`, sorted by
 * key and joined with "\n".
 *
 * Pure module (no `server-only`) so it can run under the node test runner.
 */

export type TelegramInitDataUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type VerifyInitDataResult =
  | { ok: true; user: TelegramInitDataUser; authDate: number }
  | { ok: false; error: string };

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: () => number } = {},
): VerifyInitDataResult {
  if (!botToken) return { ok: false, error: "missing_bot_token" };
  if (!initData) return { ok: false, error: "missing_init_data" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "missing_hash" };

  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const computedBuf = Buffer.from(computed, "hex");
  const providedBuf = Buffer.from(hash, "hex");
  if (
    computedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(computedBuf, providedBuf)
  ) {
    return { ok: false, error: "bad_signature" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : Number.NaN;
  if (!Number.isFinite(authDate)) return { ok: false, error: "missing_auth_date" };

  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
  if (now - authDate > maxAge) return { ok: false, error: "expired" };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, error: "missing_user" };

  let user: TelegramInitDataUser;
  try {
    const parsed = JSON.parse(userRaw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "number"
    ) {
      return { ok: false, error: "invalid_user" };
    }
    user = parsed as TelegramInitDataUser;
  } catch {
    return { ok: false, error: "invalid_user_json" };
  }

  return { ok: true, user, authDate };
}
