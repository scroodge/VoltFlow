"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { persistManualTariffLocationFromSession } from "@/actions/sessions";
import { TARIFF_LOCATION_AUTOSAVE_DELAY_MS } from "@/lib/charging-tariff-location-autosave";
import { useTranslation } from "@/hooks/use-translation";
import { queryKeys } from "@/lib/query-keys";
import type { ChargingSessionRow } from "@/types/database";

const CHECK_INTERVAL_MS = 30_000;

/**
 * Waits out TARIFF_LOCATION_AUTOSAVE_DELAY_MS after a manual provider pick on an
 * active session, then asks the server to save the car's GPS spot as a tariff
 * location (or correct an existing one) — see persistManualTariffLocationFromSession.
 */
export function useChargingTariffLocationAutosave({
  session,
  enabled = true,
}: {
  session: ChargingSessionRow | null | undefined;
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const firedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      if (
        !session ||
        session.status !== "charging" ||
        !session.tariff_manual ||
        session.provider_type === "custom" ||
        !session.tariff_selected_at
      ) {
        return;
      }

      const selectedAtMs = Date.parse(session.tariff_selected_at);
      if (!Number.isFinite(selectedAtMs)) return;
      if (Date.now() - selectedAtMs < TARIFF_LOCATION_AUTOSAVE_DELAY_MS) return;

      const key = `${session.id}:${session.tariff_selected_at}`;
      if (inFlightRef.current || firedKeyRef.current === key) return;

      inFlightRef.current = true;
      firedKeyRef.current = key;
      const sessionId = session.id;

      const run = (browserCoords: { browserLat?: number; browserLon?: number }) =>
        persistManualTariffLocationFromSession({ sessionId, ...browserCoords })
          .then(async (result) => {
            if (!result.ok || !result.applied || result.action !== "insert") return;
            await qc.invalidateQueries({ queryKey: queryKeys.tariffLocations });
            toast.success(t("charging.tariff.locationSaved", { name: result.name }) as string);
          })
          .finally(() => {
            inFlightRef.current = false;
          });

      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            void run({
              browserLat: position.coords.latitude,
              browserLon: position.coords.longitude,
            }),
          () => void run({}),
          { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
        );
      } else {
        void run({});
      }
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, qc, session, t]);
}
