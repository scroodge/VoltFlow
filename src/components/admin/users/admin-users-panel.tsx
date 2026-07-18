"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminAttentionItem } from "@/lib/admin-users-attention";
import {
  EMPTY_ADMIN_USERS_STATS,
  type AdminUsersStats,
} from "@/lib/admin-users-stats";

type ActivityCounts = {
  telemetry_7d: number;
  telemetry_30d: number;
  trips_7d: number;
  trips_30d: number;
  sessions_7d: number;
  sessions_30d: number;
};

type AdminUser = {
  id: string;
  email: string | null;
  is_premium: boolean;
  premium_until: string | null;
  created_at: string;
  is_admin: boolean;
  premium_source: "admin" | "flag" | "term" | "none";
  effective_premium: boolean;
  latest_mate_version: string | null;
  last_seen_at: string | null;
  activity: ActivityCounts;
};

type UsersResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  stats?: AdminUsersStats;
  attention?: AdminAttentionItem[];
  users: AdminUser[];
};

export function AdminUsersPanel() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [telemetryFilter, setTelemetryFilter] = useState<"none" | "7d" | "30d">("none");
  const [premiumFilter, setPremiumFilter] = useState<"all" | "yes" | "no" | "term" | "flag">("all");
  const [lastSeenFilter, setLastSeenFilter] = useState<"any" | "24h" | "7d" | "30d" | "never">("any");
  const [registeredSince, setRegisteredSince] = useState("");
  const [registeredBefore, setRegisteredBefore] = useState("");
  const [stats, setStats] = useState<AdminUsersStats>(EMPTY_ADMIN_USERS_STATS);
  const [attention, setAttention] = useState<AdminAttentionItem[] | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const resetFilters = () => {
    setPage(1);
    setUsers([]);
    setLoading(true);
  };

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "20");
    if (search.trim()) params.set("search", search.trim());
    if (telemetryFilter !== "none") params.set("telemetry", telemetryFilter);
    if (premiumFilter !== "all") params.set("premium", premiumFilter);
    if (lastSeenFilter !== "any") params.set("lastSeen", lastSeenFilter);
    if (registeredSince) params.set("registeredSince", registeredSince);
    if (registeredBefore) params.set("registeredBefore", registeredBefore);

    fetch(`/api/admin/users?${params.toString()}`, { credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json()) as UsersResponse | { error?: string };
        if (!response.ok || !("ok" in payload)) {
          throw new Error(
            "error" in payload && payload.error ? payload.error : "Failed to load users",
          );
        }
        setUsers((prev) => (page === 1 ? payload.users : [...prev, ...payload.users]));
        setHasMore(page * payload.pageSize < payload.total);
        setStats(payload.stats ?? EMPTY_ADMIN_USERS_STATS);
        setAttention(payload.attention ?? []);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load users");
      })
      .finally(() => setLoading(false));
  }, [page, search, telemetryFilter, premiumFilter, lastSeenFilter, registeredSince, registeredBefore, refreshTick]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  return (
    <div className="space-y-4">
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

      <AttentionQueue
        items={attention}
        onOpenUser={(userId) => {
          resetFilters();
          setSearch(userId);
        }}
      />

      <div className="space-y-3">
        <Input
          value={search}
          onChange={(event) => {
            resetFilters();
            setSearch(event.target.value);
          }}
          placeholder="Search by email or user id"
          className="h-10 rounded-xl"
        />

        <FilterRow label="Telemetry">
          {(["none", "7d", "30d"] as const).map((f) => (
            <FilterPill
              key={f}
              active={telemetryFilter === f}
              onClick={() => {
                if (telemetryFilter !== f) {
                  resetFilters();
                  setTelemetryFilter(f);
                }
              }}
            >
              {f === "none" ? "All" : `${f}`}
            </FilterPill>
          ))}
        </FilterRow>

        <FilterRow label="Premium">
          {(["all", "yes", "no", "term", "flag"] as const).map((f) => (
            <FilterPill
              key={f}
              active={premiumFilter === f}
              onClick={() => {
                if (premiumFilter !== f) {
                  resetFilters();
                  setPremiumFilter(f);
                }
              }}
            >
              {f === "all" ? "All" : f === "yes" ? "Premium" : f === "no" ? "Free" : f === "term" ? "Term" : "Flag"}
            </FilterPill>
          ))}
        </FilterRow>

        <FilterRow label="Last seen">
          {(["any", "24h", "7d", "30d", "never"] as const).map((f) => (
            <FilterPill
              key={f}
              active={lastSeenFilter === f}
              onClick={() => {
                if (lastSeenFilter !== f) {
                  resetFilters();
                  setLastSeenFilter(f);
                }
              }}
            >
              {f === "any" ? "Any" : f === "never" ? "Never" : `${f}`}
            </FilterPill>
          ))}
        </FilterRow>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Registered
          </span>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={registeredSince}
              onChange={(e) => {
                resetFilters();
                setRegisteredSince(e.target.value);
              }}
              className="h-8 w-36 rounded-lg text-xs"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="date"
              value={registeredBefore}
              onChange={(e) => {
                resetFilters();
                setRegisteredBefore(e.target.value);
              }}
              className="h-8 w-36 rounded-lg text-xs"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {loading && users.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users found.</p>
        ) : (
          users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              onUpdated={() => {
                setLoading(true);
                setRefreshTick((v) => v + 1);
              }}
            />
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

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs border transition ${
        active
          ? "border-[var(--voltflow-cyan)] bg-white/10"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

function UserCard({ user, onUpdated }: { user: AdminUser; onUpdated: () => void }) {
  const [showEditor, setShowEditor] = useState(false);
  const [showAdminEditor, setShowAdminEditor] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.email ?? "No email"}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {user.id}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {user.is_admin && (
            <span className="rounded-full border border-[var(--voltflow-cyan)]/30 bg-[var(--voltflow-cyan)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--voltflow-cyan)]">
              Admin
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              user.effective_premium
                ? "bg-[var(--voltflow-green)]/20 text-[var(--voltflow-green)]"
                : "bg-white/10 text-muted-foreground"
            }`}
          >
            {user.effective_premium ? "Premium" : "Free"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          Last seen:{" "}
          <span className="text-foreground">{relativeTime(user.last_seen_at)}</span>
        </span>
        <span className="text-white/10">·</span>
        <span>
          Mate:{" "}
          <span className="text-foreground">{user.latest_mate_version ?? "–"}</span>
        </span>
      </div>

      <ActivityGrid activity={user.activity} />

      <div className="border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            via{" "}
            <span className="font-medium text-foreground">{user.premium_source}</span>
            {user.premium_source === "term" && user.premium_until && (
              <>
                {" "}· until{" "}
                <span className="font-medium text-foreground">
                  {formatDate(user.premium_until)}
                </span>
              </>
            )}
          </div>
          {!user.is_admin ? (
            <button
              type="button"
              onClick={() => setShowEditor(!showEditor)}
              className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium transition hover:bg-white/[0.05]"
            >
              {showEditor ? "Hide" : "Edit"} premium
              {showEditor ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdminEditor(!showAdminEditor)}
              className="flex items-center gap-1 rounded-full border border-red-500/30 px-2.5 py-1 text-[11px] font-medium text-red-400 transition hover:bg-red-500/[0.08]"
            >
              {showAdminEditor ? "Hide" : "Revoke"} admin
              {showAdminEditor ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>
          )}
        </div>
        {showEditor && <PremiumEditor user={user} onUpdated={onUpdated} />}
        {showAdminEditor && <AdminRevoker user={user} onUpdated={onUpdated} />}
      </div>
    </div>
  );
}

function ActivityGrid({ activity }: { activity: ActivityCounts }) {
  const items = [
    { label: "Telem 7d", value: activity.telemetry_7d },
    { label: "Telem 30d", value: activity.telemetry_30d },
    { label: "Trips 7d", value: activity.trips_7d },
    { label: "Trips 30d", value: activity.trips_30d },
    { label: "Sess 7d", value: activity.sessions_7d },
    { label: "Sess 30d", value: activity.sessions_30d },
  ] as const;

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5"
        >
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {item.label}
          </p>
          <p className="text-xs font-semibold tabular-nums">
            {compactNumber(item.value)}
          </p>
        </div>
      ))}
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
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{helper}</p>
    </div>
  );
}

function AttentionQueue({
  items,
  onOpenUser,
}: {
  items: AdminAttentionItem[] | null;
  onOpenUser: (userId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = items?.slice(0, showAll ? items.length : 10) ?? [];

  return (
    <section className="rounded-xl border border-white/10 bg-card">
      <div className="flex items-baseline justify-between gap-3 px-3 py-3">
        <div>
          <h2 className="text-sm font-semibold">Needs attention</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items === null
              ? "Checking account health..."
              : items.length === 0
                ? "No current follow-up items."
                : `${items.length} actionable account${items.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {items === null ? (
        <div className="border-t border-white/10 px-3 py-4">
          <div className="h-4 w-2/5 animate-pulse rounded bg-white/[0.07]" />
        </div>
      ) : visibleItems.length === 0 ? null : (
        <div className="border-t border-white/10">
          {visibleItems.map((item) => (
            <button
              key={`${item.kind}:${item.userId}`}
              type="button"
              onClick={() => onOpenUser(item.userId)}
              className="flex w-full items-center justify-between gap-3 border-b border-white/10 px-3 py-3 text-left last:border-b-0 transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--voltflow-cyan)] focus-visible:ring-inset"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.email ?? "No email"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{attentionDetail(item)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${attentionTone(item.kind)}`}>
                {attentionLabel(item.kind)}
              </span>
            </button>
          ))}
          {items.length > 10 && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                className="text-xs font-semibold text-[var(--voltflow-cyan)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--voltflow-cyan)]"
              >
                {showAll ? "Show fewer" : `Show all ${items.length}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function attentionLabel(kind: AdminAttentionItem["kind"]) {
  switch (kind) {
    case "stale_30d":
      return "No telemetry 30d";
    case "stale_7d":
      return "No telemetry 7d";
    case "mate_update":
      return "Mate update";
    case "mate_not_activated":
      return "Mate inactive";
    case "premium_expiring":
      return "Premium ending";
  }
}

function attentionDetail(item: AdminAttentionItem) {
  switch (item.kind) {
    case "stale_30d":
    case "stale_7d":
      return `Last seen ${relativeTime(item.lastSeenAt)}`;
    case "mate_update":
      return `Mate ${item.mateVersion ?? "unknown"}, latest ${item.latestMateVersion ?? "unknown"}`;
    case "mate_not_activated":
      return `Registered ${item.createdAt ? formatDate(item.createdAt) : "recently"}, no live data yet`;
    case "premium_expiring":
      return `Term ends ${item.premiumUntil ? formatDate(item.premiumUntil) : "soon"}`;
  }
}

function attentionTone(kind: AdminAttentionItem["kind"]) {
  switch (kind) {
    case "stale_30d":
      return "border border-red-500/30 bg-red-500/10 text-red-300";
    case "stale_7d":
    case "premium_expiring":
      return "border border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "mate_update":
      return "border border-[var(--voltflow-cyan)]/30 bg-[var(--voltflow-cyan)]/10 text-[var(--voltflow-cyan)]";
    case "mate_not_activated":
      return "border border-white/10 bg-white/[0.05] text-muted-foreground";
  }
}

function PremiumEditor({ user, onUpdated }: { user: AdminUser; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [premiumUntil, setPremiumUntil] = useState<string>(
    toDatetimeLocalValue(user.premium_until),
  );
  const [flagPremium, setFlagPremium] = useState(user.is_premium);

  const applyPreset = (days: number) => {
    const next = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setPremiumUntil(toDatetimeLocalValue(next.toISOString()));
  };

  const submit = async (payload: { premiumUntil?: string | null; isPremium?: boolean }) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/premium`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Could not update premium");
      }
      toast.success("Premium updated");
      onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update premium");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="rounded-full"
          onClick={() => applyPreset(30)}
          disabled={busy}
        >
          +30d
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="rounded-full"
          onClick={() => applyPreset(90)}
          disabled={busy}
        >
          +90d
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="rounded-full"
          onClick={() => applyPreset(365)}
          disabled={busy}
        >
          +365d
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="premium-until" className="text-[11px]">
            Premium until
          </Label>
          <Input
            id="premium-until"
            type="datetime-local"
            value={premiumUntil}
            onChange={(e) => setPremiumUntil(e.target.value)}
            className="mt-1 h-8 rounded-lg text-xs"
            disabled={busy}
          />
        </div>
        <label className="flex items-center gap-1.5 pb-1 text-xs">
          <input
            type="checkbox"
            checked={flagPremium}
            onChange={(e) => setFlagPremium(e.target.checked)}
            disabled={busy}
          />
          Manual flag
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          className="rounded-full"
          onClick={() =>
            void submit({
              isPremium: flagPremium,
              premiumUntil: premiumUntil ? new Date(premiumUntil).toISOString() : null,
            })
          }
          disabled={busy}
        >
          Save
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="rounded-full"
          onClick={() => void submit({ premiumUntil: null })}
          disabled={busy}
        >
          Clear term
        </Button>
      </div>
    </div>
  );
}

function AdminRevoker({ user, onUpdated }: { user: AdminUser; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/admin`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Could not revoke admin");
      }
      toast.success("Admin role revoked");
      onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke admin");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-red-500/20 bg-red-500/[0.03] p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        This will remove <span className="font-medium text-foreground">{user.email ?? "this user"}</span>{" "}
        from the admin list. Their premium entitlement will switch to their current premium term/flag.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={busy}
          className="inline-flex min-h-8 items-center rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
        >
          {busy ? "Revoking..." : "Confirm revoke"}
        </button>
      </div>
    </div>
  );
}

function toDatetimeLocalValue(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function compactNumber(n: number) {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString();
}

function formatMetricDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "Europe/Minsk",
  }).format(date);
}
