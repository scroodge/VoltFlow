export type AdminUsersStats = {
  connectionsToday: number;
  registeredUsersTotal: number;
  registeredToday: number;
  removedToday: number;
  tripsRecordedTotal: number;
  removalsTrackedSince: string | null;
};

export const EMPTY_ADMIN_USERS_STATS: AdminUsersStats = {
  connectionsToday: 0,
  registeredUsersTotal: 0,
  registeredToday: 0,
  removedToday: 0,
  tripsRecordedTotal: 0,
  removalsTrackedSince: null,
};

type AdminUsersStatsRow = {
  connected_today?: unknown;
  registered_users_total?: unknown;
  registered_today?: unknown;
  removed_today?: unknown;
  trips_recorded_total?: unknown;
  removals_tracked_since?: unknown;
};

function countValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function rowFromRpc(data: unknown): AdminUsersStatsRow {
  if (Array.isArray(data)) {
    return (data[0] ?? {}) as AdminUsersStatsRow;
  }
  return (data ?? {}) as AdminUsersStatsRow;
}

export function mapAdminUsersStats(data: unknown): AdminUsersStats {
  const row = rowFromRpc(data);
  const trackedSince =
    typeof row.removals_tracked_since === "string" ? row.removals_tracked_since : null;

  return {
    connectionsToday: countValue(row.connected_today),
    registeredUsersTotal: countValue(row.registered_users_total),
    registeredToday: countValue(row.registered_today),
    removedToday: countValue(row.removed_today),
    tripsRecordedTotal: countValue(row.trips_recorded_total),
    removalsTrackedSince: trackedSince,
  };
}
