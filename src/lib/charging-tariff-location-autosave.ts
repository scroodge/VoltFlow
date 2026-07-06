import type {
  ChargingProviderType,
  ChargingTariffLocationRow,
  SessionStatus,
} from "../types/database.ts";

/** How long a manual provider pick must "stick" on a still-charging session before
 * the background sync is allowed to save it as a GPS tariff location. Long enough
 * to filter out mis-taps and very short stops; the car is assumed stationary while
 * charging, so the delay doesn't cost location accuracy. */
export const TARIFF_LOCATION_AUTOSAVE_DELAY_MS = 5 * 60_000;

export type TariffLocationAutosaveDecision =
  | {
      action: "skip";
      reason:
        | "not-charging"
        | "not-manual"
        | "custom-provider"
        | "too-early"
        | "no-location"
        | "already-saved-same-provider";
      matchedLocationId?: string;
    }
  | { action: "update"; matchedLocationId: string }
  | { action: "insert" };

export function decideTariffLocationAutosave(params: {
  sessionStatus: SessionStatus;
  tariffManual: boolean;
  providerType: ChargingProviderType;
  tariffSelectedAt: string | null;
  nowMs: number;
  location: { lat: number; lon: number } | null;
  matched: ChargingTariffLocationRow | null;
}): TariffLocationAutosaveDecision {
  if (params.sessionStatus !== "charging") return { action: "skip", reason: "not-charging" };
  if (!params.tariffManual) return { action: "skip", reason: "not-manual" };
  if (params.providerType === "custom") return { action: "skip", reason: "custom-provider" };

  if (!params.tariffSelectedAt) return { action: "skip", reason: "too-early" };
  const selectedAtMs = Date.parse(params.tariffSelectedAt);
  if (!Number.isFinite(selectedAtMs) || params.nowMs - selectedAtMs < TARIFF_LOCATION_AUTOSAVE_DELAY_MS) {
    return { action: "skip", reason: "too-early" };
  }

  if (!params.location) return { action: "skip", reason: "no-location" };

  if (params.matched) {
    if (params.matched.provider_type === params.providerType) {
      return {
        action: "skip",
        reason: "already-saved-same-provider",
        matchedLocationId: params.matched.id,
      };
    }
    return { action: "update", matchedLocationId: params.matched.id };
  }

  return { action: "insert" };
}

/** Appends " 2", " 3"… so a new saved location's name doesn't collide with an
 * existing one (e.g. two different Malanka spots). */
export function uniqueTariffLocationName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;
  let suffix = 2;
  while (existingNames.includes(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}
