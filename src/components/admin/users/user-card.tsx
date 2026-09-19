"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import {
  compactNumber,
  formatDate,
  relativeTime,
} from "@/lib/admin-users-format";

import { AdminRevoker } from "./admin-revoker";
import { PremiumEditor } from "./premium-editor";
import type { ActivityCounts, AdminUser } from "./types";

export function UserCard({
  user,
  onUpdated,
}: {
  user: AdminUser;
  onUpdated: () => void;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const Chevron = showEditor ? ChevronUp : ChevronDown;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {user.email ?? "No email"}
          </p>
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
          <span className="text-foreground">
            {relativeTime(user.last_seen_at)}
          </span>
        </span>
        <span className="text-white/10">·</span>
        <span>
          Mate:{" "}
          <span className="text-foreground">
            {user.latest_mate_version ?? "–"}
          </span>
        </span>
      </div>

      <ActivityGrid activity={user.activity} />

      <div className="border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            via{" "}
            <span className="font-medium text-foreground">
              {user.premium_source}
            </span>
            {user.premium_source === "term" && user.premium_until && (
              <>
                {" "}
                · until{" "}
                <span className="font-medium text-foreground">
                  {formatDate(user.premium_until)}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowEditor((v) => !v)}
            className={
              user.is_admin
                ? "flex items-center gap-1 rounded-full border border-red-500/30 px-2.5 py-1 text-[11px] font-medium text-red-400 transition hover:bg-red-500/[0.08]"
                : "flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium transition hover:bg-white/[0.05]"
            }
          >
            {showEditor ? "Hide" : user.is_admin ? "Revoke" : "Edit"}{" "}
            {user.is_admin ? "admin" : "premium"}
            <Chevron className="size-3" />
          </button>
        </div>
        {showEditor &&
          (user.is_admin ? (
            <AdminRevoker user={user} onUpdated={onUpdated} />
          ) : (
            <PremiumEditor user={user} onUpdated={onUpdated} />
          ))}
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
