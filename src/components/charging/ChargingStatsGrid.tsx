import { cn } from "@/lib/utils";

export type ChargingStat = {
  label: string;
  value: string;
  accent?: "green" | "cyan" | "blue";
};

const accentClasses = {
  green: "text-[var(--voltflow-green)]",
  cyan: "text-[var(--voltflow-cyan)]",
  blue: "text-[var(--voltflow-blue)]",
};

export function ChargingStatsGrid({ stats }: { stats: ChargingStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className="voltflow-card min-h-[92px] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {stat.label}
          </p>
          <p
            className={cn(
              "mt-3 font-heading text-2xl font-bold tracking-normal text-foreground tabular-nums",
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
