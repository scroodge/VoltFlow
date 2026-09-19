"use client";

import { AdminUsersFilters } from "./admin-users-filters";
import { AdminUsersMetrics } from "./admin-users-metrics";
import { AttentionQueue } from "./attention-queue";
import { UserCard } from "./user-card";
import { useAdminUsers } from "./use-admin-users";

export function AdminUsersPanel() {
  const {
    filters,
    setFilter,
    users,
    loading,
    hasMore,
    stats,
    attention,
    refresh,
    sentinelRef,
  } = useAdminUsers();

  return (
    <div className="space-y-4">
      <AdminUsersMetrics stats={stats} />

      <AttentionQueue
        items={attention}
        onOpenUser={(userId) => setFilter("search", userId)}
      />

      <AdminUsersFilters filters={filters} onChange={setFilter} />

      <div className="space-y-3">
        {loading && users.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users found.</p>
        ) : (
          users.map((user) => (
            <UserCard key={user.id} user={user} onUpdated={refresh} />
          ))
        )}
        {loading && users.length > 0 && (
          <p className="text-sm text-muted-foreground">Loading more...</p>
        )}
        {hasMore && <div ref={sentinelRef} className="h-4" />}
      </div>
    </div>
  );
}
