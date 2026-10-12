export const TELEGRAM_LIVE_WIDGET_THROTTLE_MS = 30_000;

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
