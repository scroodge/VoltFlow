import { isLocale, type Locale } from "./i18n.ts";

export const dashboardPreferencesCookieName = "voltflow-dashboard-preferences";

type DashboardBrowserPreferences = {
  selectedCarId: string | null;
  locale: Locale;
};

export function parseDashboardBrowserPreferences(
  value: string | undefined,
): DashboardBrowserPreferences | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const selectedCarId =
      typeof record.selectedCarId === "string" && record.selectedCarId.length > 0
        ? record.selectedCarId
        : null;
    const locale = typeof record.locale === "string" && isLocale(record.locale) ? record.locale : null;
    if (!locale) return null;
    return { selectedCarId, locale };
  } catch {
    return null;
  }
}

export function serializeDashboardBrowserPreferences(input: DashboardBrowserPreferences) {
  return encodeURIComponent(JSON.stringify(input));
}
