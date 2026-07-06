"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { isDevAppRoute } from "@/lib/dev/dev-fetch";

import { useChargingSessionLiveSync } from "@/hooks/use-charging-session-live-sync";
import { useChargingSessionAutoTariff } from "@/hooks/use-charging-session-auto-tariff";
import { useChargingTariffLocationAutosave } from "@/hooks/use-charging-tariff-location-autosave";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { chargingSessionsRefetchInterval, fetchSessions } from "@/hooks/use-sessions-query";
import { usePageVisible } from "@/hooks/use-page-visible";
import { queryKeys } from "@/lib/query-keys";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Keeps active charging_sessions rows in sync with BYDMate live SOC on any app route.
 */
export function ChargingSessionBackgroundSync() {
  const pageVisible = usePageVisible();
  const devRoute = isDevAppRoute();
  const { data: bydmateLive = [] } = useBydmateLiveQuery();
  const { data: carsResult } = useCarsQuery();
  const cars = carsResult?.cars;
  const selectedCarId = useAppPreferences((s) => s.selectedCarId);
  const selectedCar =
    cars?.find((c) => c.id === selectedCarId) ?? cars?.[0] ?? null;
  const scopedVehicleId = selectedCar?.vehicle_alias ?? null;

  const { data: sessions } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
    // Shared cadence (chargingSessionsRefetchInterval): every observer of
    // queryKeys.sessions must agree, or the shortest mounted interval wins.
    refetchInterval: (query) =>
      chargingSessionsRefetchInterval(
        query.state.data as ChargingSessionRow[] | undefined,
        pageVisible,
      ),
  });

  const activeSession = useMemo(
    () =>
      sessions?.find(
        (s) => s.status === "charging" && (!selectedCar || s.car_id === selectedCar.id),
      ) ??
      sessions?.find((s) => s.status === "charging") ??
      null,
    [sessions, selectedCar],
  );

  useChargingSessionLiveSync({
    session: activeSession,
    sessionId: activeSession?.id ?? null,
    liveSnapshots: bydmateLive,
    vehicleId: scopedVehicleId,
    enabled: Boolean(activeSession) && !devRoute,
  });

  useChargingSessionAutoTariff({
    session: activeSession,
    sessionId: activeSession?.id ?? null,
    liveSnapshots: bydmateLive,
    vehicleId: scopedVehicleId,
    enabled: Boolean(activeSession) && !devRoute,
  });

  useChargingTariffLocationAutosave({
    session: activeSession,
    enabled: Boolean(activeSession) && !devRoute,
  });

  return null;
}
