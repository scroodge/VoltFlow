import type { AdminAttentionItem } from "@/lib/admin-users-attention";
import type { AdminUsersStats } from "@/lib/admin-users-stats";

export type ActivityCounts = {
  telemetry_7d: number;
  telemetry_30d: number;
  trips_7d: number;
  trips_30d: number;
  sessions_7d: number;
  sessions_30d: number;
};

export type AdminUser = {
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

export type UsersResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  stats?: AdminUsersStats;
  attention?: AdminAttentionItem[];
  users: AdminUser[];
};

export type UsersFilters = {
  search: string;
  telemetry: "none" | "7d" | "30d";
  premium: "all" | "yes" | "no" | "term" | "flag";
  lastSeen: "any" | "24h" | "7d" | "30d" | "never";
  registeredSince: string;
  registeredBefore: string;
};

export const INITIAL_USERS_FILTERS: UsersFilters = {
  search: "",
  telemetry: "none",
  premium: "all",
  lastSeen: "any",
  registeredSince: "",
  registeredBefore: "",
};
