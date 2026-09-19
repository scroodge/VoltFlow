"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AdminAttentionItem } from "@/lib/admin-users-attention";
import {
  EMPTY_ADMIN_USERS_STATS,
  type AdminUsersStats,
} from "@/lib/admin-users-stats";

import {
  INITIAL_USERS_FILTERS,
  type AdminUser,
  type UsersFilters,
  type UsersResponse,
} from "./types";

const PAGE_SIZE = 20;

export function useAdminUsers() {
  const [filters, setFilters] = useState<UsersFilters>(INITIAL_USERS_FILTERS);
  const [page, setPage] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<AdminUsersStats>(EMPTY_ADMIN_USERS_STATS);
  const [attention, setAttention] = useState<AdminAttentionItem[] | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const setFilter = useCallback(
    <K extends keyof UsersFilters>(key: K, value: UsersFilters[K]) => {
      setFilters((prev) =>
        prev[key] === value ? prev : { ...prev, [key]: value },
      );
      setPage(1);
      setUsers([]);
      setLoading(true);
    },
    [],
  );

  const refresh = useCallback(() => {
    setPage(1);
    setLoading(true);
    setRefreshTick((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.telemetry !== "none")
      params.set("telemetry", filters.telemetry);
    if (filters.premium !== "all") params.set("premium", filters.premium);
    if (filters.lastSeen !== "any") params.set("lastSeen", filters.lastSeen);
    if (filters.registeredSince)
      params.set("registeredSince", filters.registeredSince);
    if (filters.registeredBefore)
      params.set("registeredBefore", filters.registeredBefore);

    fetch(`/api/admin/users?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          UsersResponse | { error?: string };
        if (!response.ok || !("ok" in payload)) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Failed to load users",
          );
        }
        setUsers((prev) =>
          page === 1 ? payload.users : [...prev, ...payload.users],
        );
        setHasMore(page * payload.pageSize < payload.total);
        setStats(payload.stats ?? EMPTY_ADMIN_USERS_STATS);
        setAttention(payload.attention ?? []);
        setLoading(false);
      })
      .catch((error: unknown) => {
        // A superseded request: the newer one owns the loading state.
        if (controller.signal.aborted) return;
        toast.error(
          error instanceof Error ? error.message : "Failed to load users",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [page, filters, refreshTick]);

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
  }, [hasMore, loading, users.length]);

  return {
    filters,
    setFilter,
    users,
    loading,
    hasMore,
    stats,
    attention,
    refresh,
    sentinelRef,
  };
}
