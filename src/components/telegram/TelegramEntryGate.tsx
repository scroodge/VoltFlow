"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { TelegramWelcome } from "@/components/telegram/TelegramWelcome";
import { useTranslation } from "@/hooks/use-translation";
import { loginWithTelegram } from "@/lib/telegram/login";
import { createClient } from "@/lib/supabase/client";
import { telegramApiUrl } from "@/lib/telegram/api-url";

/**
 * Context-aware gate for the `/telegram` Mini App entry.
 *
 * Detection runs in two places:
 *   1. useEffect on mount — Telegram pre-injects window.Telegram.WebApp before
 *      the page loads, so initData is already available at hydration time.
 *      This is the primary path and fires every time inside the Mini App.
 *   2. Script onReady — fallback for environments where the SDK is not
 *      pre-injected (e.g. Telegram Desktop beta, browser dev testing).
 *   A ref guard prevents double-execution when both fire.
 *
 * State machine:
 *   • Not in Telegram → renders nothing; SSR'd KB shows through (SEO preserved).
 *   • In Telegram + already authenticated → silently links telegram_id to the
 *     existing profile (idempotent) and navigates to /dashboard. Covers the
 *     "existing PWA user" case after they log in via "Already have account?"
 *     and return to /telegram.
 *   • In Telegram + not authenticated → shows TelegramWelcome overlay:
 *       - "Open the app" → loginWithTelegram() (silent new account) → /dashboard
 *       - "Already have account?" → /login?next=/telegram (email/password in
 *         WebView → callback → back here → auto-link path above)
 *       - "Knowledge base" → dismiss overlay to reveal KB underneath
 */
export function TelegramEntryGate() {
  const router = useRouter();
  const { t } = useTranslation();
  const [inTelegram, setInTelegram] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const detected = useRef(false);

  const detectTelegramAsync = async () => {
    if (detected.current) return;
    const webApp = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    if (!webApp?.initData) return;
    detected.current = true;
    webApp.ready?.();
    webApp.expand?.();

    // Check for an existing session — happens when an existing PWA user signed
    // in via "Already have account?" and was redirected back to /telegram.
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      // Link telegram_id onto the authenticated profile (idempotent).
      const response = await fetch(telegramApiUrl("/api/telegram/link"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ initData: webApp.initData }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(payload?.error ?? "telegram_link_failed");
        setInTelegram(true);
        return;
      }
      router.push("/dashboard");
      return;
    }

    setInTelegram(true);
  };

  // Primary detection: runs on mount. Telegram pre-injects window.Telegram.WebApp
  // before the page loads so initData is already available at hydration time —
  // no need to wait for the Script's onReady callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void detectTelegramAsync(); }, []);

  const handleOpenApp = async () => {
    setBusy(true);
    const result = await loginWithTelegram();
    if (result.ok) {
      router.push("/dashboard");
      return;
    }
    toast.error(`${t("telegram.loginError") as string} (${result.error})`, {
      description: t("telegram.loginExistingHint") as string,
      action: {
        label: t("telegram.loginExistingAction") as string,
        onClick: () => router.push("/login?next=/telegram"),
      },
    });
    setBusy(false);
  };

  const handleHaveAccount = () => {
    router.push("/login?next=/telegram");
  };

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onReady={() => void detectTelegramAsync()}
      />
      {inTelegram && !dismissed ? (
        <TelegramWelcome
          busy={busy}
          onOpenApp={handleOpenApp}
          onHaveAccount={handleHaveAccount}
          onOpenKnowledge={() => setDismissed(true)}
        />
      ) : null}
    </>
  );
}
