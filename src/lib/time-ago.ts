import type { TranslationKey } from "./i18n.ts";

export type TimeAgoParts = {
  key: TranslationKey;
  value: number;
};

/**
 * Buckets an elapsed duration into the coarsest sensible unit (seconds under a
 * minute, then minutes under an hour, then hours) and returns the translation
 * key plus its `{value}` interpolation. Returns null when the timestamp cannot
 * be parsed, so callers can omit the label rather than render "NaN ago".
 *
 * Kept separate from the formatting call so the bucketing is testable without
 * pulling in the i18n dictionary.
 */
export function timeAgoParts(iso: string, nowMs: number): TimeAgoParts | null {
  const thenMs = Date.parse(iso);
  if (!Number.isFinite(thenMs)) return null;

  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 60) return { key: "vehicle.timeAgoSeconds", value: seconds };

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { key: "vehicle.timeAgoMinutes", value: minutes };

  return { key: "vehicle.timeAgoHours", value: Math.round(minutes / 60) };
}

type Translator = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

export function formatTimeAgo(
  iso: string,
  nowMs: number,
  t: Translator,
): string | null {
  const parts = timeAgoParts(iso, nowMs);
  return parts ? t(parts.key, { value: parts.value }) : null;
}
