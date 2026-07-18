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
    const days = telemetry === "7d" ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: allProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id");
    const results = await Promise.all(
      (allProfiles ?? []).map(async (p) => {
        const { count } = await supabaseAdmin
          .from("bydmate_telemetry_samples")
          .select("id", { count: "exact", head: true })
          .eq("user_id", p.id)
          .gte("device_time", since);
        return count && count > 0 ? p.id : null;
      }),
    );
    telemetryUserIds = results.filter(Boolean) as string[];
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
  let negateLastSeen = false;
  if (lastSeen !== "any") {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id");
    const allProfileIds = (profiles ?? []).map((p) => p.id);

    if (lastSeen === "never") {
      const results = await Promise.all(
        allProfileIds.map(async (userId) => {
          const { count } = await supabaseAdmin
            .from("bydmate_live_snapshots")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);
          return count && count > 0 ? null : userId;
        }),
      );
      lastSeenUserIds = results.filter(Boolean) as string[];
      negateLastSeen = false;
    } else {
      const hours = lastSeen === "24h" ? 24 : lastSeen === "7d" ? 168 : 720;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const results = await Promise.all(
        allProfileIds.map(async (userId) => {
          const { count } = await supabaseAdmin
            .from("bydmate_live_snapshots")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("device_time", since);
          return count && count > 0 ? userId : null;
        }),
      );
      lastSeenUserIds = results.filter(Boolean) as string[];
    }
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

  const [adminSet, versionMap, activityMap, overview] = await Promise.all([
    loadAdminSet(userIds),
    loadLatestVersions(userIds),
    loadActivity(userIds),
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
      latest_mate_version: versionMap.get(row.id) ?? null,
      last_seen_at: versionMap.get(`${row.id}:seen`) ?? null,
      activity: activityMap.get(row.id) ?? emptyActivity(),
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

async function loadLatestVersions(userIds: string[]) {
  const versionMap = new Map<string, string>();
  if (userIds.length === 0) return versionMap;

  await Promise.all(
    userIds.map(async (userId) => {
      const { data } = await supabaseAdmin
        .from("bydmate_live_snapshots")
        .select("mate_version,device_time")
        .eq("user_id", userId)
        .order("device_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.mate_version) {
        versionMap.set(userId, String(data.mate_version));
      }
      if (data?.device_time) {
        versionMap.set(`${userId}:seen`, String(data.device_time));
      }
    }),
  );

  return versionMap;
}

async function loadActivity(userIds: string[]) {
  const map = new Map<string, ActivityCounts>();
  if (userIds.length === 0) return map;

  await Promise.all(
    userIds.map(async (userId) => {
      const [telemetry7, telemetry30, trips7, trips30, sessions7, sessions30] =
        await Promise.all([
          countRows(
            "bydmate_telemetry_samples",
            userId,
            "device_time",
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          ),
          countRows(
            "bydmate_telemetry_samples",
            userId,
            "device_time",
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          ),
          countRows(
            "bydmate_trips",
            userId,
            "started_at",
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          ),
          countRows(
            "bydmate_trips",
            userId,
            "started_at",
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          ),
          countRows(
            "charging_sessions",
            userId,
            "created_at",
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          ),
          countRows(
            "charging_sessions",
            userId,
            "created_at",
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          ),
        ]);

      map.set(userId, {
        telemetry_7d: telemetry7,
        telemetry_30d: telemetry30,
        trips_7d: trips7,
        trips_30d: trips30,
        sessions_7d: sessions7,
        sessions_30d: sessions30,
      });
    }),
  );

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

async function countRows(
  table: "bydmate_telemetry_samples" | "bydmate_trips" | "charging_sessions",
  userId: string,
  timeColumn: "device_time" | "started_at" | "created_at",
  sinceIso: string,
) {
  const { count } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte(timeColumn, sinceIso);

  return count ?? 0;
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
