// "Ends ~12:34" for the dashboard charging tile: the clock time the active
// charge reaches 100%, derived from the same time-left ETA as "Time left".
export const CHARGING_END_TIME_MIN_SECONDS = 60;
export const CHARGING_END_TIME_MAX_SECONDS = 48 * 3600;

const DAY_MS = 24 * 3600 * 1000;

function localDayIndex(date: Date): number {
  return Math.round(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() /
      DAY_MS,
  );
}

function clockTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Returns null when there is no honest end time to show: almost done (or
// already at 100%), a non-finite ETA, or a stalled power reading that pushes
// the ETA beyond 48 h. Times use the device time zone, always 24 h.
export function formatChargingEndTime({
  nowMs,
  timeLeftSeconds,
  locale,
  tomorrowLabel,
}: {
  nowMs: number;
  timeLeftSeconds: number;
  locale: string;
  tomorrowLabel: string;
}): string | null {
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(timeLeftSeconds) ||
    timeLeftSeconds <= CHARGING_END_TIME_MIN_SECONDS ||
    timeLeftSeconds > CHARGING_END_TIME_MAX_SECONDS
  ) {
    return null;
  }
  const now = new Date(nowMs);
  const end = new Date(nowMs + timeLeftSeconds * 1000);
  const dayOffset = localDayIndex(end) - localDayIndex(now);
  const time = `~${clockTime(end)}`;
  if (dayOffset <= 0) return time;
  if (dayOffset === 1) return `${time} ${tomorrowLabel}`;
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(end);
  return `${time}, ${date}`;
}
