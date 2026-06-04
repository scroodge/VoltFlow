export type IngestStats = {
  inserted_count: number;
  skipped_stale_count: number;
  duplicate_count: number;
};

/** Maps RPC jsonb from bydmate_ingest_telemetry(_batch) to HTTP ACK fields. */
export function parseIngestStats(result: unknown, payloadCount: number): IngestStats {
  if (!result || typeof result !== "object") {
    return {
      inserted_count: payloadCount,
      skipped_stale_count: 0,
      duplicate_count: 0,
    };
  }

  const record = result as Record<string, unknown>;
  const skippedStale =
    typeof record.skipped_stale_count === "number" ? record.skipped_stale_count : 0;

  if (typeof record.inserted_count === "number") {
    const duplicate =
      typeof record.duplicate_count === "number"
        ? record.duplicate_count
        : Math.max(0, payloadCount - record.inserted_count - skippedStale);
    return {
      inserted_count: record.inserted_count,
      skipped_stale_count: skippedStale,
      duplicate_count: duplicate,
    };
  }

  if (record.duplicate === true) {
    return {
      inserted_count: 0,
      skipped_stale_count: skippedStale,
      duplicate_count: 1,
    };
  }

  const processed =
    typeof record.sample_count === "number" ? record.sample_count : payloadCount;
  const duplicate = Math.max(0, payloadCount - processed - skippedStale);

  return {
    inserted_count: Math.max(0, processed - duplicate),
    skipped_stale_count: skippedStale,
    duplicate_count: duplicate,
  };
}
