export type SohHistoryPoint = {
  device_time: string;
  telemetry: { soh_percent: number };
};

export function normalizeSohPercent(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      return parsed;
    }
  }
  return null;
}

/** Maps compact RPC rows while rejecting malformed values before they reach charts. */
export function mapSohDailyRows(
  rows: readonly { device_time: string; soh_percent: number | string | null }[],
): SohHistoryPoint[] {
  return rows.flatMap((row): SohHistoryPoint[] => {
    const soh = normalizeSohPercent(row.soh_percent);
    return soh == null
      ? []
      : [{ device_time: row.device_time, telemetry: { soh_percent: soh } }];
  });
}
