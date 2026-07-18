export const ADMIN_ATTENTION_KINDS = [
  "stale_30d",
  "stale_7d",
  "mate_update",
  "mate_not_activated",
  "premium_expiring",
] as const;

export type AdminAttentionKind = (typeof ADMIN_ATTENTION_KINDS)[number];

export type AdminAttentionItem = {
  kind: AdminAttentionKind;
  priority: number;
  userId: string;
  email: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  mateVersion: string | null;
  latestMateVersion: string | null;
  premiumUntil: string | null;
};

type AdminAttentionRpcRow = {
  kind?: unknown;
  priority?: unknown;
  user_id?: unknown;
  email?: unknown;
  created_at?: unknown;
  last_seen_at?: unknown;
  mate_version?: unknown;
  latest_mate_version?: unknown;
  premium_until?: unknown;
};

function isAttentionKind(value: unknown): value is AdminAttentionKind {
  return typeof value === "string" && ADMIN_ATTENTION_KINDS.includes(value as AdminAttentionKind);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

export function mapAdminUsersAttention(data: unknown): AdminAttentionItem[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((raw) => {
    const row = raw as AdminAttentionRpcRow;
    const kind = isAttentionKind(row.kind) ? row.kind : null;
    const userId = nullableString(row.user_id);
    if (!kind || !userId) return [];

    return [{
      kind,
      priority: nonNegativeInteger(row.priority),
      userId,
      email: nullableString(row.email),
      createdAt: nullableString(row.created_at),
      lastSeenAt: nullableString(row.last_seen_at),
      mateVersion: nullableString(row.mate_version),
      latestMateVersion: nullableString(row.latest_mate_version),
      premiumUntil: nullableString(row.premium_until),
    }];
  });
}
