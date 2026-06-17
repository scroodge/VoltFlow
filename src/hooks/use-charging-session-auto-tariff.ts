"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { syncChargingSessionTariffFromGps } from "@/actions/sessions";
import { filterLiveSnapshotsForVehicle } from "@/lib/charging-session-sync";
import { queryKeys } from "@/lib/query-keys";
import type { BydmateLiveSnapshotRow, ChargingSessionRow } from "@/types/database";

const GPS_TARIFF_SYNC_MIN_INTERVAL_MS = 15_000;

function liveLocationForVehicle(
  snapshots: BydmateLiveSnapshotRow[],
  vehicleId: string | null | undefined,
) {
  const scoped = filterLiveSnapshotsForVehicle(snapshots, vehicleId);
  for (const snapshot of scoped) {
    const lat = snapshot.location?.lat;
    const lon = snapshot.location?.lon;
    if (typeof lat === "number" && typeof lon === "number") {
      return { lat, lon };
    }
  }
  return null;
}

export function useChargingSessionAutoTariff({
  session,
  sessionId,
  liveSnapshots,
  vehicleId,
  enabled = true,
}: {
  session: ChargingSessionRow | null | undefined;
  sessionId: string | null;
  liveSnapshots: BydmateLiveSnapshotRow[];
  vehicleId?: string | null;
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);
  const lastLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId || !session || session.status !== "charging" || session.tariff_manual) {
      return;
    }

    const location = liveLocationForVehicle(liveSnapshots, vehicleId);
    if (!location) return;

    const locationKey = `${location.lat.toFixed(5)}:${location.lon.toFixed(5)}`;
    const now = Date.now();
    if (
      syncingRef.current ||
      (locationKey === lastLocationKeyRef.current &&
        now - lastSyncAtRef.current < GPS_TARIFF_SYNC_MIN_INTERVAL_MS)
    ) {
      return;
    }

    syncingRef.current = true;
    lastLocationKeyRef.current = locationKey;
    lastSyncAtRef.current = now;

    void syncChargingSessionTariffFromGps({
      sessionId,
      lat: location.lat,
      lon: location.lon,
    })
      .then(async (result) => {
        if (!result.ok) return;
        if (result.applied) {
          await qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
          await qc.invalidateQueries({ queryKey: queryKeys.sessions });
        }
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [
    enabled,
    liveSnapshots,
    qc,
    session,
    session?.tariff_manual,
    session?.status,
    sessionId,
    vehicleId,
  ]);
}
