export const TELEGRAM_LIVE_WIDGET_THROTTLE_MS = 30_000;
export const TELEGRAM_LIVE_WIDGET_BACKLOG_MS = 10 * 60 * 1000;

/**
 * A batch whose newest sample is this old is a replayed offline queue, not live state.
 * After an offline charge Mate flushes hours of queued samples *after* the daemon already
 * delivered the current state, so rendering the batch's newest sample would walk the
 * widget backwards (car `cl`, 2026-10-21: parked 99.7 % → "charging 90.8 %").
 */
export function isTelegramLiveWidgetBacklogSample(
  deviceTime: string,
  nowMs: number,
) {
  const deviceMs = Date.parse(deviceTime);
  return (
    Number.isFinite(deviceMs) &&
    nowMs - deviceMs > TELEGRAM_LIVE_WIDGET_BACKLOG_MS
  );
}

export type TelegramLiveWidgetEditRow = {
  status: string;
  updated_at: string;
  last_state: string | null;
};

/**
 * Same-state edits (SOC, speed, range) are throttled; a state change is not. The batch
 * that carries a parking transition is often the last one before a car stops delivering,
 * so throttling it would freeze the widget on "driving" until the next ingest.
 */
export function isTelegramLiveWidgetEditDue(
  existing: TelegramLiveWidgetEditRow | null,
  nowMs: number,
  nextState: string,
) {
  if (!existing || existing.status !== "active") return true;
  if (existing.last_state != null && existing.last_state !== nextState)
    return true;
  const lastEditMs = Date.parse(existing.updated_at);
  return (
    !Number.isFinite(lastEditMs) ||
    nowMs - lastEditMs >= TELEGRAM_LIVE_WIDGET_THROTTLE_MS
  );
}
