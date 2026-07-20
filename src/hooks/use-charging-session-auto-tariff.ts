"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useTranslation } from "@/hooks/use-translation";
import { syncChargingSessionTariffFromGps } from "@/actions/sessions";
import {
  coordinatesFromLiveSnapshots,
  type GpsCoordinates,
} from "@/lib/charging-gps-location";
import { queryKeys } from "@/lib/query-keys";
import type { BydmateLiveSnapshotRow, ChargingSessionRow } from "@/types/database";

const GPS_TARIFF_SYNC_MIN_INTERVAL_MS = 15_000;

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
  const { t } = useTranslation();
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);
  const lastLocationKeyRef = useRef<string | null>(null);
  // Browser GPS is used only for this mounted charging session. Do not persist
  // exact coordinates locally; a saved tariff location is the explicit user
  // choice to keep a place in Postgres under RLS.
  const [browserLocation, setBrowserLocation] = useState<GpsCoordinates | null>(null);

  const mateLocation = coordinatesFromLiveSnapshots(liveSnapshots, vehicleId);
  const needsBrowserGps =
    enabled &&
    Boolean(sessionId) &&
    Boolean(session) &&
    session?.status === "charging" &&
    !session?.tariff_manual &&
    !mateLocation &&
    !browserLocation;

  useEffect(() => {
    if (!needsBrowserGps || !navigator.geolocation) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setBrowserLocation(nextLocation);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 12_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [needsBrowserGps]);

  const activeLocation = mateLocation ?? browserLocation;

  useEffect(() => {
    if (!enabled || !sessionId || !session || session.status !== "charging" || session.tariff_manual) {
      return;
    }

    if (!activeLocation) return;

    const locationKey = `${activeLocation.lat.toFixed(5)}:${activeLocation.lon.toFixed(5)}`;
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
      lat: activeLocation.lat,
      lon: activeLocation.lon,
    })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (result.applied) {
          await qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
          await qc.invalidateQueries({ queryKey: queryKeys.sessions });
          if (result.locationName) {
            toast.success(
              t("charging.tariff.appliedFrom", { name: result.locationName }) as string,
            );
          }
        }
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [
    activeLocation,
    enabled,
    qc,
    session,
    session?.tariff_manual,
    session?.status,
    sessionId,
    t,
  ]);

  return {
    mateLocation,
    browserLocation,
    activeLocation,
    gpsSource: mateLocation ? ("mate-live" as const) : browserLocation ? ("browser" as const) : null,
  };
}
