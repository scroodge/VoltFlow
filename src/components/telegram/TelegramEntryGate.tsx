"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { TelegramWelcome } from "@/components/telegram/TelegramWelcome";
import { useTranslation } from "@/hooks/use-translation";
import { loginWithTelegram } from "@/lib/telegram/login";

/**
 * Context-aware gate for the `/telegram` Mini App entry.
 *
 * - In a plain browser → renders nothing; the SSR'd knowledge base shows through
 *   (preserves SEO / shareable links).
 * - Inside Telegram (real `initData` after the SDK loads) → shows the welcome /
 *   onboarding overlay. "Open the app" runs the silent Telegram login (lazy
 *   account creation) and routes to /dashboard; "Knowledge base" dismisses the
 *   overlay to reveal the KB underneath.
 *
 * Detection runs from the SDK script's onReady callback (not a useEffect) to
 * avoid the react-hooks/set-state-in-effect rule.
 */
export function TelegramEntryGate() {
  const router = useRouter();
  const { t } = useTranslation();
  const [inTelegram, setInTelegram] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const detectTelegram = () => {
    const webApp = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    if (!webApp?.initData) return;
    webApp.ready?.();
    webApp.expand?.();
    setInTelegram(true);
  };

  const handleOpenApp = async () => {
    setBusy(true);
    const result = await loginWithTelegram();
    if (result.ok) {
      router.push("/dashboard");
      return;
    }
    toast.error(t("telegram.loginError") as string);
    setBusy(false);
  };

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onReady={detectTelegram}
      />
      {inTelegram && !dismissed ? (
        <TelegramWelcome
          busy={busy}
          onOpenApp={handleOpenApp}
          onOpenKnowledge={() => setDismissed(true)}
        />
      ) : null}
    </>
  );
}
