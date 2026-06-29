"use client";

import { createClient } from "@/lib/supabase/client";

type TelegramAuthResponse = {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  telegram_id?: number;
  error?: string;
};

export type TelegramLoginResult =
  | { ok: true; telegramId: number | null }
  | { ok: false; error: string };

/** Read the raw, server-verifiable initData string from the Telegram WebView. */
function readInitData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData ?? "";
}

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
  const initData = readInitData();
  if (!initData) return { ok: false, error: "not_in_telegram" };

  let payload: TelegramAuthResponse;
  try {
    const response = await fetch("/api/telegram/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    payload = (await response.json()) as TelegramAuthResponse;
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (!payload.ok || !payload.access_token || !payload.refresh_token) {
    return { ok: false, error: payload.error ?? "auth_failed" };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, telegramId: payload.telegram_id ?? null };
}
