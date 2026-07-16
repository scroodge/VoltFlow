"use client";

import { type CSSProperties, type ReactNode, useEffect, useMemo } from "react";

import { MateUpdateBanner } from "@/components/dashboard/mate-update-banner";
import { ChargingSessionBackgroundSync } from "@/components/charging/charging-session-background-sync";
import { DefaultProvidersSeed } from "@/components/settings/default-providers-seed";
import { ChargingDevSourceProvider } from "@/components/dev/charging-dev-source-context";
import { DashboardDevSnapshotProvider } from "@/components/dev/dashboard-dev-snapshot-context";
import { VehicleDevSnapshotProvider } from "@/components/dev/vehicle-dev-snapshot-context";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import {
  ConnectCarBanner,
  OnboardingGate,
} from "@/components/onboarding/onboarding-gate";
import { touchUserActivity } from "@/actions/activity";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { getTelegramThemeStyle } from "@/lib/telegram/theme";
import { useTelegramWebApp } from "@/lib/telegram/useTelegramWebApp";
import { cn } from "@/lib/utils";

function MateUpdateBannerHost() {
  const { data: bydmateLive = [] } = useBydmateLiveQuery();
  const installedVersion =
    bydmateLive.find((snapshot) => snapshot.mate_version)?.mate_version ?? null;

  return (
    <div className="px-6 pt-4">
      <MateUpdateBanner installedVersion={installedVersion} />
    </div>
  );
}

export function MobileShell({ children }: { children: ReactNode }) {
  const telegram = useTelegramWebApp();

  useEffect(() => {
    try {
      const lastTouch = localStorage.getItem("voltflow:last_active_touch");
      const hourAgo = Date.now() - 3600_000;
      if (lastTouch && Number(lastTouch) > hourAgo) return;
      localStorage.setItem("voltflow:last_active_touch", String(Date.now()));
      void touchUserActivity();
    } catch {}
  }, []);
  const telegramThemeStyle = useMemo(() => {
    if (!telegram.isTelegram) return undefined;

    const contentInsets = telegram.contentSafeAreaInset ?? telegram.safeAreaInset;
    const viewportHeight = telegram.viewportHeight ?? telegram.viewportStableHeight;

    return {
      ...getTelegramThemeStyle(telegram.themeParams),
      "--telegram-viewport-height": viewportHeight ? `${viewportHeight}px` : "100dvh",
      "--telegram-safe-top": `${contentInsets?.top ?? 0}px`,
      "--telegram-safe-bottom": `${contentInsets?.bottom ?? 0}px`,
    } as CSSProperties;
  }, [
    telegram.contentSafeAreaInset,
    telegram.isTelegram,
    telegram.safeAreaInset,
    telegram.themeParams,
    telegram.viewportHeight,
    telegram.viewportStableHeight,
  ]);
  const compactTelegramLayout =
    telegram.isTelegram &&
    (telegram.viewportHeight ?? telegram.viewportStableHeight ?? Number.POSITIVE_INFINITY) <= 640;

  return (
    <DashboardDevSnapshotProvider>
      <VehicleDevSnapshotProvider>
      <ChargingDevSourceProvider>
      <ChargingSessionBackgroundSync />
      <DefaultProvidersSeed />
      <OnboardingGate />
      <div className="mobile-page">
        <div
          className={cn(
            "flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]",
            telegram.isTelegram && "telegram-webview",
            compactTelegramLayout && "telegram-compact",
          )}
          style={telegramThemeStyle}
        >
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]">
            <ConnectCarBanner />
            <MateUpdateBannerHost />
            {children}
          </main>
          <BottomNavigation />
        </div>
      </div>
      </ChargingDevSourceProvider>
      </VehicleDevSnapshotProvider>
    </DashboardDevSnapshotProvider>
  );
}
