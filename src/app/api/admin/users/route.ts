import { NextRequest, NextResponse } from "next/server";

import { mapAdminUsersAttention } from "@/lib/admin-users-attention";
import { mapAdminUsersStats } from "@/lib/admin-users-stats";
import { isPremiumFromUntil, resolveEffectivePremium } from "@/lib/premium-entitlement";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/knowledge";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type AdminUserRow = {
  id: string;
  email: string | null;
  is_premium: boolean;
  premium_until?: string | null;
  created_at: string;
};

type ActivityCounts = {
  telemetry_7d: number;
  telemetry_30d: number;
  trips_7d: number;
  trips_30d: number;
  sessions_7d: number;
  sessions_30d: number;
};

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const overviewPromise = loadAdminOverview();

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = clampPageSize(params.get("pageSize"));
  const search = (params.get("search") ?? "").trim().toLowerCase();
  const telemetry = params.get("telemetry") ?? "";
  const premiumFilter = params.get("premium") ?? "all";
  const lastSeen = params.get("lastSeen") ?? "any";
  const registeredSince = params.get("registeredSince") ?? "";
  const registeredBefore = params.get("registeredBefore") ?? "";

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const allAdminIds = await loadAllAdminIds();

  let telemetryUserIds: string[] | undefined;
  if (telemetry === "7d" || telemetry === "30d") {
    const { data, error } = await supabaseAdmin.rpc("admin_users_activity_filter_ids", {
      p_filter: telemetry,
    });
    if (error) return NextResponse.json({ error: "Activity filter failed" }, { status: 500 });
    telemetryUserIds = ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
    if (telemetryUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        page,
        pageSize,
        total: 0,
        ...(await overviewPromise),
        users: [],
      });
    }
  }

  let lastSeenUserIds: string[] | undefined;
  const negateLastSeen = false;
  if (lastSeen !== "any") {
    const filter =
      lastSeen === "7d"
        ? "7d_seen"
        : lastSeen === "30d"
          ? "30d_seen"
          : lastSeen === "24h" || lastSeen === "never"
            ? lastSeen
            : "30d_seen";
    const { data, error } = await supabaseAdmin.rpc("admin_users_activity_filter_ids", {
      p_filter: filter,
    });
    if (error) return NextResponse.json({ error: "Last-seen filter failed" }, { status: 500 });
    lastSeenUserIds = ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  }

  let filterUserIds: string[] | undefined;
  let negateFilter = false;
  if (telemetryUserIds && lastSeenUserIds) {
    const intersection = new Set(telemetryUserIds);
    filterUserIds = lastSeenUserIds.filter((id) => intersection.has(id));
    negateFilter = negateLastSeen;
    if (!negateFilter && filterUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        page,
        pageSize,
        total: 0,
        ...(await overviewPromise),
        users: [],
      });
    }
  } else {
    filterUserIds = telemetryUserIds ?? lastSeenUserIds;
    negateFilter = negateLastSeen;
  }

  if (filterUserIds && filterUserIds.length === 0 && !negateFilter) {
    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total: 0,
      ...(await overviewPromise),
      users: [],
    });
  }

  const primary = await runProfilesQuery({
    includePremiumUntil: true,
    from,
    to,
    search,
    filterUserIds,
    negateFilter,
    premiumFilter,
    allAdminIds,
    registeredSince,
    registeredBefore,
  });
  const fallback =
    primary.error &&
    primary.error.code === "42703" &&
    primary.error.message.includes("premium_until")
      ? await runProfilesQuery({
          includePremiumUntil: false,
          from,
          to,
          search,
          filterUserIds,
          negateFilter,
          premiumFilter,
          allAdminIds,
          registeredSince,
          registeredBefore,
        })
      : null;
  const result = fallback ?? primary;
  const { data, error, count } = result;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = (data ?? []) as unknown as AdminUserRow[];
  const userIds = users.map((row) => row.id);
  const now = Date.now();

  const [adminSet, metricsMap, overview] = await Promise.all([
    loadAdminSet(userIds),
    loadUserMetrics(userIds),
    overviewPromise,
  ]);

  const enriched = users.map((row) => {
    const isAdmin = adminSet.has(row.id);
    const premiumUntilActive = isPremiumFromUntil(row.premium_until, now);
    return {
      ...row,
      is_admin: isAdmin,
      premium_source: isAdmin
        ? "admin"
        : row.is_premium
          ? "flag"
          : premiumUntilActive
            ? "term"
            : "none",
      effective_premium: resolveEffectivePremium({
        isAdmin,
        isPremiumFlag: row.is_premium,
        premiumUntil: row.premium_until,
        nowMs: now,
      }),
      latest_mate_version: metricsMap.get(row.id)?.latest_mate_version ?? null,
      last_seen_at: metricsMap.get(row.id)?.last_seen_at ?? null,
      activity: metricsMap.get(row.id)?.activity ?? emptyActivity(),
    };
  });

  return NextResponse.json({
    ok: true,
    page,
    pageSize,
    total: count ?? 0,
    ...overview,
    users: enriched,
  });
}

function clampPageSize(value: string | null) {
  const parsed = Number.parseInt(value ?? String(DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, parsed));
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function runProfilesQuery(params: {
  includePremiumUntil: boolean;
  from: number;
  to: number;
  search: string;
  filterUserIds?: string[];
  negateFilter?: boolean;
  premiumFilter: string;
  allAdminIds: Set<string>;
  registeredSince: string;
  registeredBefore: string;
}) {
  let query = supabaseAdmin
    .from("profiles")
    .select(
      params.includePremiumUntil
        ? "id,email,is_premium,premium_until,created_at"
        : "id,email,is_premium,created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(params.from, params.to);

  if (params.search.length > 0) {
    if (looksLikeUuid(params.search)) {
      query = query.eq("id", params.search);
    } else {
      query = query.ilike("email", `%${params.search}%`);
    }
  }

  if (params.filterUserIds && params.filterUserIds.length > 0) {
    if (params.negateFilter) {
      const ids = params.filterUserIds.map((id) => `"${id}"`).join(",");
      query = query.filter("id", "not.in", `(${ids})`);
    } else {
      query = query.in("id", params.filterUserIds);
    }
  }

  if (params.premiumFilter === "yes") {
    const isoNow = new Date().toISOString();
    const conditions = [`is_premium.eq.true`, `premium_until.gte.${isoNow}`];
    if (params.allAdminIds.size > 0) {
      conditions.push(`id.in.(${[...params.allAdminIds].join(",")})`);
    }
    query = query.or(conditions.join(","));
  } else if (params.premiumFilter === "no") {
    const isoNow = new Date().toISOString();
    query = query.or("is_premium.is.null,is_premium.eq.false");
    query = query.or(`premium_until.is.null,premium_until.lt.${isoNow}`);
    if (params.allAdminIds.size > 0) {
      const ids = [...params.allAdminIds].map((id) => `"${id}"`).join(",");
      query = query.filter("id", "not.in", `(${ids})`);
    }
  } else if (params.premiumFilter === "term") {
    const isoNow = new Date().toISOString();
    query = query.not("premium_until", "is", null);
    query = query.gte("premium_until", isoNow);
  } else if (params.premiumFilter === "flag") {
    query = query.eq("is_premium", true);
  }

  if (params.registeredSince) {
    query = query.gte("created_at", params.registeredSince);
  }
  if (params.registeredBefore) {
    query = query.lte("created_at", params.registeredBefore);
  }

  return query;
}

async function loadAllAdminIds() {
  const { data } = await supabaseAdmin.from("admin_users").select("user_id");
  return new Set<string>((data ?? []).map((r) => String(r.user_id)).filter(Boolean));
}

async function loadAdminSet(userIds: string[]) {
  if (userIds.length === 0) return new Set<string>();
  const { data } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .in("user_id", userIds);
  return new Set((data ?? []).map((row) => String(row.user_id)));
}

type AdminUserMetrics = {
  latest_mate_version: string | null;
  last_seen_at: string | null;
  activity: ActivityCounts;
};

async function loadUserMetrics(userIds: string[]) {
  const map = new Map<string, AdminUserMetrics>();
  if (userIds.length === 0) return map;

  const { data, error } = await supabaseAdmin.rpc("admin_users_user_metrics", {
    p_user_ids: userIds,
  });
  if (error) throw new Error(`Could not load user metrics: ${error.message}`);

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const userId = String(row.user_id);
    map.set(userId, {
      latest_mate_version: row.latest_mate_version ? String(row.latest_mate_version) : null,
      last_seen_at: row.last_seen_at ? String(row.last_seen_at) : null,
      activity: {
        telemetry_7d: Number(row.telemetry_7d) || 0,
        telemetry_30d: Number(row.telemetry_30d) || 0,
        trips_7d: Number(row.trips_7d) || 0,
        trips_30d: Number(row.trips_30d) || 0,
        sessions_7d: Number(row.sessions_7d) || 0,
        sessions_30d: Number(row.sessions_30d) || 0,
      },
    });
  }
  return map;
}

function emptyActivity(): ActivityCounts {
  return {
    telemetry_7d: 0,
    telemetry_30d: 0,
    trips_7d: 0,
    trips_30d: 0,
    sessions_7d: 0,
    sessions_30d: 0,
  };
}

async function loadAdminStats() {
  const { data, error } = await supabaseAdmin.rpc("admin_users_dashboard_stats");
  if (error) {
    throw new Error(`Could not load admin dashboard stats: ${error.message}`);
  }
  return mapAdminUsersStats(data);
}

async function loadAdminOverview() {
  const [stats, attention] = await Promise.all([loadAdminStats(), loadAdminAttention()]);
  return { stats, attention };
}

async function loadAdminAttention() {
  const { data, error } = await supabaseAdmin.rpc("admin_users_attention_queue");
  if (error) {
    throw new Error(`Could not load admin attention queue: ${error.message}`);
  }
  return mapAdminUsersAttention(data);
}
