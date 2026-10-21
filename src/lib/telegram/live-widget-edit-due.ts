export const TELEGRAM_LIVE_WIDGET_THROTTLE_MS = 30_000;
/** A rendered sample older than this is stale: the widget shows its time, and the throttle is off. */
export const TELEGRAM_LIVE_WIDGET_STALE_MS = 3 * 60 * 1000;

export type TelegramLiveWidgetEditRow = {
  status: string;
  updated_at: string;
  last_state: string | null;
  rendered_device_time?: string | null;
};

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when the incoming newest sample is older than the one the widget already shows.
 * After an offline charge Mate flushes hours of queued samples *after* the daemon already
 * delivered the current state, so rendering such a batch would walk the widget backwards
 * (car `cl`, 2026-10-21: parked 99.7 % at 12:40 → "charging 90.8 %" from 11:46).
 */
export function isTelegramLiveWidgetRegression(
  existing: TelegramLiveWidgetEditRow | null,
  nextDeviceTime: string,
) {
  if (!existing || existing.status !== "active") return false;
  const renderedMs = parseMs(existing.rendered_device_time);
  const nextMs = parseMs(nextDeviceTime);
  return renderedMs != null && nextMs != null && nextMs < renderedMs;
}

/**
 * Same-state edits (SOC, speed, range) are throttled; a state change is not. The batch
 * that carries a parking transition is often the last one before a car stops delivering,
 * so throttling it would freeze the widget on "driving" until the next ingest. A widget
 * showing stale data is not throttled either: an offline queue is flushed in batches ~10 s
 * apart, and throttling the last one would leave the widget on an intermediate sample.
 */
export function isTelegramLiveWidgetEditDue(
  existing: TelegramLiveWidgetEditRow | null,
  nowMs: number,
  nextState: string,
) {
  if (!existing || existing.status !== "active") return true;
  if (existing.last_state != null && existing.last_state !== nextState)
    return true;
  const renderedMs = parseMs(existing.rendered_device_time);
  if (renderedMs != null && nowMs - renderedMs > TELEGRAM_LIVE_WIDGET_STALE_MS)
    return true;
  const lastEditMs = Date.parse(existing.updated_at);
  return (
    !Number.isFinite(lastEditMs) ||
    nowMs - lastEditMs >= TELEGRAM_LIVE_WIDGET_THROTTLE_MS
  );
}
