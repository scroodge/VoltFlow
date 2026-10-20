export type AuxVoltageDailyPoint = {
  date: string;
  vMin: number;
  vMax: number;
  vResting: number | null;
  restingSampleCount: number;
};

export type AuxVoltageDailyRow = {
  date: string;
  v_min: unknown;
  v_max: unknown;
  v_resting: unknown;
  resting_sample_count: unknown;
};

export function normalizeAuxVoltage(raw: unknown): number | null {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 6 && value <= 18 ? value : null;
}

const AUX_TREND_WEEK_DAYS = 7;

/**
 * Window for the daily 12 V trend. Rollups exist only for completed UTC days, so the
 * current ISO week would show just the days since Monday (none on Monday). While the
 * selected week is still in progress, show the last 7 completed days instead.
 */
export function resolveAuxTrendWindow(
  range: string,
  window: { from: string; to: string },
  now: Date = new Date(),
): { from: string; to: string } {
  if (range !== "week" || Date.parse(window.to) <= now.getTime()) return window;
  const from = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - AUX_TREND_WEEK_DAYS,
    ),
  );
  return { from: from.toISOString(), to: now.toISOString() };
}

export function mapAuxVoltageDailyRows(
  rows: readonly AuxVoltageDailyRow[],
): AuxVoltageDailyPoint[] {
  return rows.flatMap((row) => {
    const vMin = normalizeAuxVoltage(row.v_min);
    const vMax = normalizeAuxVoltage(row.v_max);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      vMin == null ||
      vMax == null ||
      vMin > vMax
    )
      return [];
    const vResting = normalizeAuxVoltage(row.v_resting);
    const count = Number(row.resting_sample_count);
    return [
      {
        date: row.date,
        vMin,
        vMax,
        vResting,
        restingSampleCount:
          Number.isInteger(count) && count > 0 && vResting != null ? count : 0,
      },
    ];
  });
}
