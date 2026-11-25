"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { DashboardDevToolbar } from "@/components/dev/dashboard-dev-toolbar";
import {
  DashboardDevSnapshotProvider,
  parseDevMode,
  useDashboardDevSnapshot,
  type DashboardDevSnapshotMode,
} from "@/components/dev/dashboard-dev-snapshot-context";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import type { updateChargingSessionTariff } from "@/features/charging/actions";
import { costFromGridEnergy } from "@/features/charging/domain";
import { useTranslation } from "@/hooks/use-translation";
import { buildMockChargingSession } from "@/lib/dev/build-mock-charging-session";
import { noopSubscribe } from "@/lib/pwa";
import { queryKeys } from "@/lib/query-keys";
import type { Car, ChargingSessionRow, UserProviderRow } from "@/types/database";

const createdAt = "2026-01-01T00:00:00.000Z";

const car: Car = {
  id: "dev-preview-car",
  user_id: "dev-preview-user",
  name: "Yuan UP · Dev",
  model_generation: "gen1_2024",
  battery_chemistry: null,
  battery_capacity_kwh: 45.1,
  default_charger_power_kw: 7.4,
  default_efficiency_percent: 98,
  fast_dc_efficiency_percent: 90,
  range_reserve_soc_percent: 10,
  vehicle_alias: "dev-dashboard",
  created_at: createdAt,
};

const provider: UserProviderRow = {
  id: "dev-preview-provider",
  user_id: car.user_id,
  label: "Dev Station",
  home_price_per_kwh: 0.24,
  commercial_ac_price_per_kwh: 0.49,
  fast_dc_price_per_kwh: 0.69,
  is_default: true,
  created_at: createdAt,
  updated_at: createdAt,
};

function buildSession(mode: DashboardDevSnapshotMode): ChargingSessionRow | null {
  if (!mode.startsWith("charge-")) return null;

  const dc = mode === "charge-dc";
  const noPrice = mode === "charge-no-price";
  const free = mode === "charge-free";
  const price = noPrice || free ? 0 : dc ? provider.fast_dc_price_per_kwh : provider.commercial_ac_price_per_kwh;
  const chargedEnergy = 10.5;
  return {
    ...buildMockChargingSession(),
    car_id: car.id,
    battery_capacity_kwh: car.battery_capacity_kwh,
    charger_power_kw: dc ? 48 : car.default_charger_power_kw,
    efficiency_percent: dc ? car.fast_dc_efficiency_percent : car.default_efficiency_percent,
    tariff_type: dc ? "fast_dc" : "commercial_ac",
    provider_type: noPrice || free ? "custom" : "user_provider",
    user_provider_id: noPrice || free ? null : provider.id,
    tariff_manual: free,
    price_per_kwh: price,
    current_percent: 58,
    charged_energy_kwh: chargedEnergy,
    estimated_cost: costFromGridEnergy(chargedEnergy, price),
  };
}

export function DashboardSimulator({ initialScenario }: { initialScenario: string }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    client.setQueryData(queryKeys.userProviders, [provider]);
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardDevSnapshotProvider initialMode={parseDevMode(initialScenario)}>
        <SimulatorScenarios />
      </DashboardDevSnapshotProvider>
    </QueryClientProvider>
  );
}

function SimulatorScenarios() {
  const scenario = useDashboardDevSnapshot();
  const [revision, setRevision] = useState(0);
  if (!scenario) return null;

  return (
    <SimulatorCase
      key={`${scenario.mode}:${revision}`}
      mode={scenario.mode}
      onReset={() => setRevision((value) => value + 1)}
    />
  );
}

function SimulatorCase({
  mode,
  onReset,
}: {
  mode: DashboardDevSnapshotMode;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  // The simulator's telemetry and session clock begin in the browser.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [session, setSession] = useState(() => buildSession(mode));
  const [failNextSave, setFailNextSave] = useState(false);

  const saveTariff: typeof updateChargingSessionTariff = async (input) => {
    setFailNextSave(false);

    // Leave the pending state visible for manual UI checks.
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (failNextSave) return { ok: false, error: String(t("charging.tariff.saveError")) };
    if (!session || input.sessionId !== session.id) {
      return { ok: false, error: String(t("charging.unavailable")) };
    }

    setSession({
      ...session,
      tariff_manual: true,
      tariff_type: input.tariffType,
      provider_type: input.providerType,
      user_provider_id: input.userProviderId ?? null,
      price_per_kwh: input.pricePerKwh,
      estimated_cost: costFromGridEnergy(session.charged_energy_kwh, input.pricePerKwh),
    });
    return { ok: true };
  };

  return (
    <div className="mobile-page">
      <div className="flex h-dvh flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <DashboardDevToolbar
            simulation={{
              failNextSave,
              setFailNextSave,
              onReset,
            }}
          />
          {mounted ? <DashboardView simulation={{ car, session, saveTariff }} /> : null}
        </main>
        <BottomNavigation />
      </div>
    </div>
  );
}
