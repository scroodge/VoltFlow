"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { TelegramWelcome } from "@/components/telegram/TelegramWelcome";
import { useTranslation } from "@/hooks/use-translation";
import { loginWithTelegram } from "@/lib/telegram/login";
import { createClient } from "@/lib/supabase/client";
import { telegramApiUrl } from "@/lib/telegram/api-url";
import { readTelegramInitData } from "@/lib/telegram/init-data";

/**
 * Context-aware gate for the `/telegram` Mini App entry.
 *
 * Detection reads initData via readTelegramInitData(), which prefers the SDK
 * but falls back to the URL hash (#tgWebAppData=…) — so it works even when
 * telegram-web-app.js fails to load (CSP/network/WebView). It runs on mount and
 * again on Script onReady; a ref guard prevents double-execution.
 *
 * This page renders no knowledge-base markup: the KB lives at `/knowledge/*`.
 * The old pre-paint guard, revealKnowledgeBase() and its safety timeout existed
 * only because the gate and the KB shared a URL, and are gone with the split.
 *
 * Navigations out of /telegram use HARD loads (window.location), not the Next
 * router. Soft RSC navigations fetch `/<route>?_rsc=…` from Vercel, which the
 * Vercel Security Checkpoint challenges inside the Telegram WebView — the router
 * then silently fails and the user is left on a blank /telegram. A full page
 * load goes through the same path as the initial /telegram load that succeeded.
 *
 * State machine:
 *   • Not in Telegram → sends the visitor to the public KB at /knowledge.
 *   • In Telegram + already authenticated → loads /dashboard immediately and
 *     stamps telegram_id in the background (idempotent). Covers the "existing
 *     PWA user" case after they log in via "Already have account?".
 *   • In Telegram + not authenticated → shows TelegramWelcome overlay:
 *       - "Open the app" → loginWithTelegram() (silent new account) → /dashboard
 *       - "Already have account?" → /login?next=/telegram (email/password in
 *         WebView → callback → back here → auto-link path above)
 *       - "Knowledge base" → /knowledge
 */
/** Hard navigation — survives the Vercel Security Checkpoint inside the WebView. */
function hardNavigate(path: string) {
  if (typeof window !== "undefined") window.location.assign(path);
}

export function TelegramEntryGate() {
  const { t } = useTranslation();
  const [inTelegram, setInTelegram] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const detected = useRef(false);

  const detectTelegramAsync = async () => {
    if (detected.current) return;
    const initData = readTelegramInitData();
    if (!initData) {
      // Plain browser on the Mini App entry URL: this route has no content of
      // its own any more, so send them to the KB rather than a blank page.
      hardNavigate("/knowledge");
      return;
    }
    detected.current = true;
    const webApp = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    webApp?.ready?.();
    webApp?.expand?.();

    // Check for an existing session — happens when an existing PWA user signed
    // in via "Already have account?" and was redirected back to /telegram.
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      // Returning user: navigate immediately so they never see the KB cover or
      // wait on the link round-trip. Stamp telegram_id in the background — it is
      // idempotent and retried on every authenticated open if this call fails.
      void fetch(telegramApiUrl("/api/telegram/link"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ initData }),
        keepalive: true,
      }).catch(() => {});
      hardNavigate("/dashboard");
      return;
    }

    setInTelegram(true);
  };

  // Primary detection: runs on mount. readTelegramInitData() reads the URL hash
  // so it resolves even before (or without) the SDK; onReady re-runs it as a
  // belt-and-suspenders trigger.
  useEffect(() => {
    // setState only runs after async awaits inside detectTelegramAsync, so there
    // is no synchronous render cascade despite the rule's static analysis.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detectTelegramAsync();
  }, []);

  const handleOpenApp = async () => {
    setBusy(true);
    const result = await loginWithTelegram();
    if (result.ok) {
      hardNavigate("/dashboard");
      return;
    }
    toast.error(`${t("telegram.loginError") as string} (${result.error})`, {
      description: t("telegram.loginExistingHint") as string,
      action: {
        label: t("telegram.loginExistingAction") as string,
        onClick: () => hardNavigate("/login?next=/telegram"),
      },
    });
    setBusy(false);
  };

  const handleHaveAccount = () => {
    hardNavigate("/login?next=/telegram");
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
          onOpenKnowledge={() => {
            setDismissed(true);
            hardNavigate("/knowledge");
          }}
        />
      ) : null}
    </>
  );
}
