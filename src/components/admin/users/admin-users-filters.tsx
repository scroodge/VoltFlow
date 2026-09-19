"use client";

import { Input } from "@/components/ui/input";

import type { UsersFilters } from "./types";

type Option<V extends string> = { value: V; label: string };

const TELEMETRY_OPTIONS: Option<UsersFilters["telemetry"]>[] = [
  { value: "none", label: "All" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

const PREMIUM_OPTIONS: Option<UsersFilters["premium"]>[] = [
  { value: "all", label: "All" },
  { value: "yes", label: "Premium" },
  { value: "no", label: "Free" },
  { value: "term", label: "Term" },
  { value: "flag", label: "Flag" },
];

const LAST_SEEN_OPTIONS: Option<UsersFilters["lastSeen"]>[] = [
  { value: "any", label: "Any" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "never", label: "Never" },
];

export function AdminUsersFilters({
  filters,
  onChange,
}: {
  filters: UsersFilters;
  onChange: <K extends keyof UsersFilters>(
    key: K,
    value: UsersFilters[K],
  ) => void;
}) {
  return (
    <div className="space-y-3">
      <Input
        value={filters.search}
        onChange={(event) => onChange("search", event.target.value)}
        placeholder="Search by email or user id"
        className="h-10 rounded-xl"
      />

      <FilterGroup
        label="Telemetry"
        options={TELEMETRY_OPTIONS}
        value={filters.telemetry}
        onSelect={(v) => onChange("telemetry", v)}
      />
      <FilterGroup
        label="Premium"
        options={PREMIUM_OPTIONS}
        value={filters.premium}
        onSelect={(v) => onChange("premium", v)}
      />
      <FilterGroup
        label="Last seen"
        options={LAST_SEEN_OPTIONS}
        value={filters.lastSeen}
        onSelect={(v) => onChange("lastSeen", v)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Registered
        </span>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={filters.registeredSince}
            onChange={(e) => onChange("registeredSince", e.target.value)}
            className="h-8 w-36 rounded-lg text-xs"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={filters.registeredBefore}
            onChange={(e) => onChange("registeredBefore", e.target.value)}
            className="h-8 w-36 rounded-lg text-xs"
          />
        </div>
      </div>
    </div>
  );
}

function FilterGroup<V extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: Option<V>[];
  value: V;
  onSelect: (value: V) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className={`rounded-full px-3 py-1 text-xs border transition ${
              value === option.value
                ? "border-[var(--voltflow-cyan)] bg-white/10"
                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
