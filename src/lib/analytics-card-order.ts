export const ANALYTICS_CARD_IDS = [
  "soh",
  "battery_health",
  "cell_balance",
  "aux_12v",
  "charging_trends",
  "phantom",
  "range_prediction",
  "consumption_vs_temp",
  "route_insights",
  "lifetime_map",
  "export",
] as const;

export type AnalyticsCardId = (typeof ANALYTICS_CARD_IDS)[number];

export const DEFAULT_ANALYTICS_CARD_ORDER: readonly AnalyticsCardId[] = ANALYTICS_CARD_IDS;

const CARD_ID_SET: ReadonlySet<string> = new Set<string>(ANALYTICS_CARD_IDS);

/**
 * Sanitizes any persisted/unknown value into a full card order: unknown and duplicate
 * ids are dropped, missing ids are appended in default order so cards added in future
 * releases still show up for users with a saved order.
 */
export function normalizeCardOrder(value: unknown): AnalyticsCardId[] {
  const ordered = new Set<AnalyticsCardId>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && CARD_ID_SET.has(item)) {
        ordered.add(item as AnalyticsCardId);
      }
    }
  }
  for (const id of ANALYTICS_CARD_IDS) {
    ordered.add(id);
  }
  return [...ordered];
}

export const analyticsCardOrderStorageKey = "voltflow-analytics-card-order";

export function loadStoredCardOrder(): AnalyticsCardId[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(analyticsCardOrderStorageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeCardOrder(parsed) : null;
  } catch {
    return null;
  }
}

export function storeCardOrderLocally(order: readonly AnalyticsCardId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(analyticsCardOrderStorageKey, JSON.stringify(order));
  } catch {
    // Private mode / quota — the profile copy still carries the order.
  }
}
