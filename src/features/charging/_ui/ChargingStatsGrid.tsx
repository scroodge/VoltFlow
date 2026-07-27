import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ChargingStat = {
  label: string;
  value: ReactNode;
  accent?: "green" | "cyan" | "blue";
};

const accentClasses = {
  green: "text-[var(--voltflow-green)]",
  cyan: "text-[var(--voltflow-cyan)]",
  blue: "text-[var(--voltflow-blue)]",
};

export function ChargingStatsGrid({
  stats,
  compact = false,
}: {
  stats: ChargingStat[];
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className={cn("voltflow-card", compact ? "min-h-[72px] p-3" : "min-h-[92px] p-4")}>
          <p className={cn(
            "font-semibold uppercase text-muted-foreground",
            compact ? "text-[10px] tracking-[0.14em]" : "text-[11px] tracking-[0.18em]",
          )}>
            {stat.label}
          </p>
          <p
            className={cn(
              "font-heading font-bold tracking-normal text-foreground tabular-nums",
              compact ? "mt-2 text-xl" : "mt-3 text-2xl",
              stat.accent && accentClasses[stat.accent],
            )}
          >
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
