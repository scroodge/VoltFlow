import type { AdminUsersStats } from "@/lib/admin-users-stats";
import { compactNumber, formatMetricDate } from "@/lib/admin-users-format";

export function AdminUsersMetrics({ stats }: { stats: AdminUsersStats }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile
        label="Connected today"
        value={compactNumber(stats.connectionsToday)}
        helper="Minsk time"
      />
      <MetricTile
        label="Registered users"
        value={compactNumber(stats.registeredUsersTotal)}
        helper="Current total"
      />
      <MetricTile
        label="Registered / removed"
        value={`+${compactNumber(stats.registeredToday)} / −${compactNumber(stats.removedToday)}`}
        helper={
          stats.removalsTrackedSince
            ? `Minsk time · tracked since ${formatMetricDate(stats.removalsTrackedSince)}`
            : "Minsk time · tracking starts with this release"
        }
      />
      <MetricTile
        label="Trips recorded"
        value={compactNumber(stats.tripsRecordedTotal)}
        helper="All time, including open"
      />
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: React.ReactNode;
  helper: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        {helper}
      </p>
    </div>
  );
}
