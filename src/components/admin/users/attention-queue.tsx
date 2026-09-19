"use client";

import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useState } from "react";

import type { AdminAttentionItem } from "@/lib/admin-users-attention";
import { formatDate, relativeTime } from "@/lib/admin-users-format";

const COLLAPSED_COUNT = 10;

export function AttentionQueue({
  items,
  onOpenUser,
}: {
  items: AdminAttentionItem[] | null;
  onOpenUser: (userId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visibleItems =
    items?.slice(0, showAll ? items.length : COLLAPSED_COUNT) ?? [];
  const expandable = items !== null && items.length > 0;
  const Chevron = expanded ? ChevronUp : ChevronDown;

  const summary =
    items === null
      ? "Checking account health..."
      : items.length === 0
        ? "No current follow-up items."
        : `${items.length} actionable account${items.length === 1 ? "" : "s"}`;

  return (
    <section className="rounded-xl border border-white/10 bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? expanded : undefined}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--voltflow-cyan)] focus-visible:ring-inset"
      >
        <div>
          <h2 className="text-sm font-semibold">Needs attention</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
        </div>
        {expandable && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
            {expanded ? "Hide" : "Show"}
            <Chevron className="size-3" />
          </span>
        )}
      </button>

      {items === null ? (
        <div className="border-t border-white/10 px-3 py-4">
          <div className="h-4 w-2/5 animate-pulse rounded bg-white/[0.07]" />
        </div>
      ) : !expanded || visibleItems.length === 0 ? null : (
        <div className="border-t border-white/10">
          <p className="px-3 pt-2 text-[11px] text-muted-foreground">
            Accounts that may need a follow-up. Click one to filter the list
            below to that user.
          </p>
          {visibleItems.map((item) => (
            <button
              key={`${item.kind}:${item.userId}`}
              type="button"
              onClick={() => onOpenUser(item.userId)}
              title="Filter the list to this user"
              className="flex w-full items-center justify-between gap-3 border-b border-white/10 px-3 py-3 text-left last:border-b-0 transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--voltflow-cyan)] focus-visible:ring-inset"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {item.email ?? "No email"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {attentionDetail(item)}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${attentionTone(item.kind)}`}
                >
                  {attentionLabel(item.kind)}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </span>
            </button>
          ))}
          {items.length > COLLAPSED_COUNT && (
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
