"use client";

import { createClient } from "@/lib/supabase/client";
import { telegramApiUrl } from "@/lib/telegram/api-url";
import { readTelegramInitData } from "@/lib/telegram/init-data";

type TelegramAuthResponse = {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  telegram_id?: number;
  error?: string;
  detail?: string;
};

export type TelegramLoginResult =
  | { ok: true; telegramId: number | null }
  | { ok: false; error: string };

/**
 * Exchange the Telegram Mini App `initData` for a Supabase session.
 *
 * Posts the raw initData to `/api/telegram/auth` (which verifies the HMAC and
 * mints a session), then installs the returned tokens via `setSession`. After
 * this resolves, the rest of the app sees a normal authenticated Supabase user.
 *
 * Returns `not_in_telegram` when there is no initData (e.g. opened in a plain
 * browser) so callers can fall back to the standard Google/email login.
 */
export async function loginWithTelegram(): Promise<TelegramLoginResult> {
  const initData = readTelegramInitData();
  if (!initData) return { ok: false, error: "not_in_telegram" };

  let payload: TelegramAuthResponse;
  let response: Response;
  try {
    response = await fetch(telegramApiUrl("/api/telegram/auth"), {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ initData }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `network_error:${error instanceof Error ? error.message : "fetch_failed"}`,
    };
  }

  const responseText = await response.text();
  if (response.headers.get("x-vercel-mitigated") === "challenge") {
    return { ok: false, error: "vercel_security_challenge" };
  }
  if (/Vercel Security Checkpoint/i.test(responseText)) {
    return { ok: false, error: "vercel_security_challenge" };
  }

  try {
    payload = JSON.parse(responseText) as TelegramAuthResponse;
  } catch {
    return { ok: false, error: `http_${response.status}:non_json_response` };
  }

  if (!payload.ok || !payload.access_token || !payload.refresh_token) {
    const detail = payload.detail ? `:${payload.detail}` : "";
    return { ok: false, error: `${payload.error ?? "auth_failed"}${detail}` };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, telegramId: payload.telegram_id ?? null };
}
