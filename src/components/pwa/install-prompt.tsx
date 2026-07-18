"use client";

import { Download, MoreVertical, Share, SquarePlus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/use-translation";
import { isIos, isStandalone, noopSubscribe, subscribeDisplayMode } from "@/lib/pwa";
import { isTelegramWebView } from "@/lib/telegram/environment";

// Chrome/Edge/Android fire this before showing their own install banner. We
// capture it, suppress the default mini-infobar, and drive a first-class button.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Landing-page install funnel. Renders nothing once the app runs installed.
 * Android/Chromium → one-tap install button (captured beforeinstallprompt).
 * iOS Safari (no such event) → Share → Add to Home Screen instructions.
 * Other desktop browsers → generic add-to-home hint.
 */
export function InstallPrompt() {
  const { t } = useTranslation();
  const installed = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const ios = useSyncExternalStore(noopSubscribe, isIos, () => false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const telegramWebView = useSyncExternalStore(noopSubscribe, isTelegramWebView, () => false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setHidden(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Already installed (or just finished installing) → the landing CTA stack
  // handles "open app"; nothing to show here.
  if (installed || hidden || telegramWebView) return null;

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setHidden(true);
    setDeferred(null);
  }

  // Android / Chromium desktop: native install available.
  if (deferred) {
    return (
      <Button
        size="lg"
        onClick={() => void handleInstall()}
        className="h-14 w-full rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] font-heading text-base font-bold text-[#06110B] voltflow-glow"
      >
        <Download className="size-5" aria-hidden />
        {t("landing.installAction")}
      </Button>
    );
  }

  // iOS Safari (and desktop fallback): show manual add-to-home steps.
  return (
    <div className="voltflow-card p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-white/[0.04] text-[var(--voltflow-green)]">
          <Download className="size-5" aria-hidden />
        </div>
        <div>
          <p className="font-heading text-base font-bold">
            {t("landing.installTitle")}
          </p>
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
            {t("landing.installSubtitle")}
          </p>
        </div>
      </div>
      <ol className="mt-3 space-y-2 text-sm leading-6">
        <li className="flex items-center gap-2">
          {ios ? (
            <Share className="size-4 shrink-0 text-[var(--voltflow-cyan)]" aria-hidden />
          ) : (
            <MoreVertical className="size-4 shrink-0 text-[var(--voltflow-cyan)]" aria-hidden />
          )}
          <span>{ios ? t("landing.installIosStep1") : t("landing.installGenericStep1")}</span>
        </li>
        <li className="flex items-center gap-2">
          <SquarePlus
            className="size-4 shrink-0 text-[var(--voltflow-cyan)]"
            aria-hidden
          />
          <span>{t("landing.installIosStep2")}</span>
        </li>
      </ol>
    </div>
  );
}
