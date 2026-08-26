export type DayTelemetryBucketPoint = {
  device_time: string;
  telemetry: Record<string, unknown>;
  diplus_charge_gun_state?: string | number | null;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

export type DayTelemetryBucketRow = DayTelemetryBucketPoint & {
  bucket_id: number;
  bucket_kind: number;
  source_sample_count: number | string;
  source_first_time: string;
  source_last_time: string;
};

/** Reject incomplete RPC responses instead of drawing a confident partial day. */
export function mapDayTelemetryBucketRows<TPoint extends DayTelemetryBucketPoint>(
  rows: readonly (TPoint & DayTelemetryBucketRow)[],
  maxPoints: number,
): TPoint[] {
  if (rows.length === 0) return [];
  if (rows.length > maxPoints) throw new Error("Day telemetry aggregation exceeded the chart point budget");

  const first = rows[0]!;
  const sourceCount = Number(first.source_sample_count);
  const sourceFirst = Date.parse(first.source_first_time);
  const sourceLast = Date.parse(first.source_last_time);
  const returnedFirst = Date.parse(first.device_time);
  const returnedLast = Date.parse(rows.at(-1)!.device_time);
  const metadataIsConsistent = rows.every((row) =>
    Number(row.source_sample_count) === sourceCount
    && row.source_first_time === first.source_first_time
    && row.source_last_time === first.source_last_time,
  );
  if (!Number.isInteger(sourceCount) || sourceCount <= 0 || !metadataIsConsistent
      || !Number.isFinite(sourceFirst) || !Number.isFinite(sourceLast)
      || returnedFirst !== sourceFirst || returnedLast !== sourceLast) {
    throw new Error("Day telemetry aggregation did not cover the complete source window");
  }
  return rows.map((row) => {
    const point = { ...row } as Partial<DayTelemetryBucketRow> & TPoint;
    delete point.bucket_id;
    delete point.bucket_kind;
    delete point.source_sample_count;
    delete point.source_first_time;
    delete point.source_last_time;
    return point;
  });
}
