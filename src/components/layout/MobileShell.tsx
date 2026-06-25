"use client";

import { type ReactNode } from "react";

import { MateUpdateBanner } from "@/components/dashboard/mate-update-banner";
import { ChargingSessionBackgroundSync } from "@/components/charging/charging-session-background-sync";
import { ChargingDevSourceProvider } from "@/components/dev/charging-dev-source-context";
import { DashboardDevSnapshotProvider } from "@/components/dev/dashboard-dev-snapshot-context";
import { VehicleDevSnapshotProvider } from "@/components/dev/vehicle-dev-snapshot-context";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import {
  ConnectCarBanner,
  OnboardingGate,
} from "@/components/onboarding/onboarding-gate";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";

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
  return (
    <DashboardDevSnapshotProvider>
      <VehicleDevSnapshotProvider>
      <ChargingDevSourceProvider>
      <ChargingSessionBackgroundSync />
      <OnboardingGate />
      <div className="mobile-page">
        <div className="flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]">
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
