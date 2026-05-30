"use client";

import { type ReactNode } from "react";

import { ChargingDevSourceProvider } from "@/components/dev/charging-dev-source-context";
import { DashboardDevSnapshotProvider } from "@/components/dev/dashboard-dev-snapshot-context";
import { VehicleDevSnapshotProvider } from "@/components/dev/vehicle-dev-snapshot-context";
import { BottomNavigation } from "@/components/layout/BottomNavigation";

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <DashboardDevSnapshotProvider>
      <VehicleDevSnapshotProvider>
      <ChargingDevSourceProvider>
      <div className="mobile-page">
        <div className="flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]">
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]">
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
