"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  stats?: {
    connectionsToday: number;
    registeredUsersTotal: number;
  };
  users: AdminUser[];
};

export function AdminUsersPanel() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [stats, setStats] = useState<{ connectionsToday: number; registeredUsersTotal: number }>({
    connectionsToday: 0,
    registeredUsersTotal: 0,
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) {
      params.set("search", search.trim());
    }
    fetch(`/api/admin/users?${params.toString()}`, { credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json()) as UsersResponse | { error?: string };
        if (!response.ok || !("ok" in payload)) {
          throw new Error(
            "error" in payload && payload.error ? payload.error : "Failed to load users",
          );
        }
        setUsers(payload.users ?? []);
        setStats(payload.stats ?? { connectionsToday: 0, registeredUsersTotal: 0 });
        if (payload.users.length > 0 && !payload.users.find((item) => item.id === selectedId)) {
          setSelectedId(payload.users[0]?.id ?? null);
        }
        if (payload.users.length === 0) {
          setSelectedId(null);
        }
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load users");
      })
      .finally(() => setLoading(false));
  }, [search, refreshTick, selectedId]);

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedId) ?? null,
    [users, selectedId],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricTile label="Connections today" value={stats.connectionsToday} />
        <MetricTile label="Registered users" value={stats.registeredUsersTotal} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
      <Card size="sm" className="border-white/10">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Users</CardTitle>
          <Input
            value={search}
            onChange={(event) => {
              setLoading(true);
              setSearch(event.target.value);
            }}
            placeholder="Search by email or user id"
            className="h-10 rounded-xl"
          />
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading users...</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelectedId(user.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  selectedId === user.id
                    ? "border-[var(--voltflow-cyan)] bg-white/10"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                }`}
              >
                <p className="truncate text-sm font-medium">
                  {user.email ?? "No email"} {user.is_admin ? "(admin)" : ""}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{user.id}</p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      user.effective_premium
                        ? "bg-[var(--voltflow-green)]/20 text-[var(--voltflow-green)]"
                        : "bg-white/10 text-muted-foreground"
                    }`}
                  >
                    {user.effective_premium ? "Premium" : "Free"}
                  </span>
                  <span className="text-muted-foreground">via {user.premium_source}</span>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>
      <Card size="sm" className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base">User details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedUser ? (
            <>
              <section className="space-y-1 text-sm">
                <p className="font-medium">{selectedUser.email ?? "No email"}</p>
                <p className="font-mono text-xs text-muted-foreground">{selectedUser.id}</p>
                <p className="text-xs text-muted-foreground">
                  Last seen: {formatDate(selectedUser.last_seen_at)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Mate version: {selectedUser.latest_mate_version ?? "Unknown"}
                </p>
              </section>

              <section className="grid grid-cols-2 gap-2 text-xs">
                <MetricTile label="Telemetry 7d" value={selectedUser.activity.telemetry_7d} />
                <MetricTile label="Telemetry 30d" value={selectedUser.activity.telemetry_30d} />
                <MetricTile label="Trips 7d" value={selectedUser.activity.trips_7d} />
                <MetricTile label="Trips 30d" value={selectedUser.activity.trips_30d} />
                <MetricTile label="Sessions 7d" value={selectedUser.activity.sessions_7d} />
                <MetricTile label="Sessions 30d" value={selectedUser.activity.sessions_30d} />
              </section>

              <PremiumEditor
                key={selectedUser.id}
                user={selectedUser}
                onUpdated={() => {
                  setLoading(true);
                  setRefreshTick((value) => value + 1);
                }}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a user to view details.</p>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function PremiumEditor({
  user,
  onUpdated,
}: {
  user: AdminUser;
  onUpdated: () => void;
}) {
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

  if (user.is_admin) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-sm font-semibold">Permanent premium (admin)</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Admin accounts are always premium and do not use expiry.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-sm font-semibold">Premium controls</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-full text-xs"
          onClick={() => applyPreset(30)}
          disabled={busy}
        >
          +30d
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-full text-xs"
          onClick={() => applyPreset(90)}
          disabled={busy}
        >
          +90d
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-full text-xs"
          onClick={() => applyPreset(365)}
          disabled={busy}
        >
          +365d
        </Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="premium-until">Premium until</Label>
        <Input
          id="premium-until"
          type="datetime-local"
          value={premiumUntil}
          onChange={(event) => setPremiumUntil(event.target.value)}
          className="h-10 rounded-xl"
          disabled={busy}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={flagPremium}
          onChange={(event) => setFlagPremium(event.target.checked)}
          disabled={busy}
        />
        Manual premium flag
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-9 rounded-full"
          onClick={() =>
            void submit({
              isPremium: flagPremium,
              premiumUntil: premiumUntil ? new Date(premiumUntil).toISOString() : null,
            })
          }
          disabled={busy}
        >
          Save premium
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 rounded-full"
          onClick={() => void submit({ premiumUntil: null })}
          disabled={busy}
        >
          Clear term
        </Button>
      </div>
    </section>
  );
}

function toDatetimeLocalValue(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
